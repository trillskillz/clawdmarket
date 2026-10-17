// The matching committed patch replaces the sole fast-glob import with Node 24 fs.globSync.
// Remove only that now-unused dependency. All other audit findings remain visible.
module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === '@next/eslint-plugin-next') {
        const fastGlob = pkg.dependencies?.['fast-glob'];
        // Idempotent: pnpm can re-run this hook on a manifest rebuilt from the
        // lockfile (e.g. `pnpm update -r`, which Dependabot uses), where
        // fast-glob was already removed. Any other version or fast-glob range
        // still requires reevaluating the patch.
        if (pkg.version !== '16.3.8' || (fastGlob !== undefined && fastGlob !== '3.3.1')) {
          throw new Error('Reevaluate the scoped Next ESLint security patch before upgrading');
        }
        if (fastGlob !== undefined) delete pkg.dependencies['fast-glob'];
      }
      return pkg;
    },
  },
};
