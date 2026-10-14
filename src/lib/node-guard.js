// The CLI targets Node 22+ (keep in step with package.json "engines"). On an older Node a feature
// fails with a stack trace that does not name the cause, so check the version first and say so
// plainly. Imported before any other module so it runs before that failure can.
const MIN_MAJOR = 22;
const major = Number(process.versions.node.split('.')[0]);
if (major < MIN_MAJOR) {
  console.error(`cxm needs Node ${MIN_MAJOR} or newer — you are running Node ${process.versions.node}.`);
  console.error('Install a current Node (https://nodejs.org), then run cxm again.');
  process.exit(1);
}
