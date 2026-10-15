// The matching committed patch replaces the sole fast-glob import with Node 24 fs.globSync.
// Remove only that now-unused dependency. All other audit findings remain visible.
module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === '@next/eslint-plugin-next') {
        if (pkg.version !== '16.3.8' || pkg.dependencies?.['fast-glob'] !== '3.3.1') {
          throw new Error('Reevaluate the scoped Next ESLint security patch before upgrading');
        }
        delete pkg.dependencies['fast-glob'];
      }
      return pkg;
    },
  },
};
