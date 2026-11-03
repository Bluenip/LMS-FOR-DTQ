// Local development/test storage only; never publish this emulator to the Internet.
const { mkdirSync } = require('node:fs');
const S3rver = require('s3rver');

const directory = '/data';
mkdirSync(directory, { recursive: true });
const server = new S3rver({
  address: '0.0.0.0',
  port: 9000,
  directory,
  silent: true,
  vhostBuckets: false,
  configureBuckets: [{ name: process.env.S3_BUCKET || 'lms' }],
});
server.run().then(
  () => console.log('Local S3 emulator listening on port 9000'),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
