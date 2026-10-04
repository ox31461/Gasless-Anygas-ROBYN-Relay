// Refuse to publish a version that is not strictly newer than what a registry already serves.
// Usage: node no-downgrade.mjs <version> npm:<name> | jsr:<@scope/name> | pypi:<name> ...
// Exits 1 with a GitHub ::error:: line if any registry already has an equal or higher version.
const [version, ...targets] = process.argv.slice(2);

const parse = (v) => {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(v));
  if (!m) throw new Error(`not semver: ${v}`);
  return { nums: m.slice(1, 4).map(Number), pre: m[4] ?? null };
};
// Compare semver precedence (prerelease sorts before its release; prerelease ids compared as strings).
export function cmp(a, b) {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i];
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}

async function published(target) {
  const [reg, name] = [target.slice(0, target.indexOf(':')), target.slice(target.indexOf(':') + 1)];
  const get = async (url) => {
    const r = await fetch(url);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
    return r.json();
  };
  if (reg === 'npm') return Object.keys((await get(`https://registry.npmjs.org/${name}`))?.versions ?? {});
  if (reg === 'jsr') return Object.keys((await get(`https://jsr.io/${name}/meta.json`))?.versions ?? {});
  if (reg === 'pypi') return Object.keys((await get(`https://pypi.org/pypi/${name}/json`))?.releases ?? {});
  throw new Error(`unknown registry ${reg}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let bad = false;
  for (const t of targets) {
    const versions = (await published(t)).filter((v) => { try { parse(v); return true; } catch { return false; } });
    const max = versions.sort(cmp).at(-1);
    if (max && cmp(version, max) <= 0) {
      console.log(`::error::${t} already has ${max}; refusing to publish ${version} (would not be newest). Bump the version.`);
      bad = true;
    } else {
      console.log(`${t}: newest published ${max ?? '(none)'} -> ${version} ok`);
    }
  }
  process.exit(bad ? 1 : 0);
}
