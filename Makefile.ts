import * as fs from 'fs';
import yargs from 'yargs';
import { Logger } from 'tslog';
import * as execa from 'execa';
import * as hasha from 'hasha';
import * as archiver from 'archiver';
import * as readline from 'readline';
import * as git from 'isomorphic-git';
import * as gitHttp from 'isomorphic-git/http/node';

// >>> CONFIGURATION
// -----------------------------------------------------------------------------
// Supply input to this task runner via CLI options or environment vars.
//
// see: https://yargs.js.org/
const config = yargs(process.argv.slice(2))
	.option('githubToken', { default: process.env['GITHUB_TOKEN'] })
	.option('nfpmVersion', { default: process.env['NFPM_VERSION'] ?? '1.10.3' })
	.option('versionNo', { default: process.env['VERSION_NO'] ?? '0.0.0' })
	.option('date', { default: process.env['DATE'] ?? new Date().toISOString() })
	.option('commitUrl', { default: process.env['COMMIT_URL'] ?? 'https://github.com/owner/project/commit/hash' })
	.argv;

// >>> LOGGING
// -----------------------------------------------------------------------------
// All output from this task runner will be through this logger.
//
// see: https://tslog.js.org/
const logger = new Logger({
	displayInstanceName: false,
	displayLoggerName: false,
	displayFunctionName: false,
	displayFilePath: 'hidden',
});

// >>> UTILS
// -----------------------------------------------------------------------------
// Functions that we use in our tasks.

/**
 * Executes a child process and outputs all stdio through the supplied logger.
 */
async function exe(log: Logger, args?: readonly string[], options?: execa.Options) {
	const proc = execa(args[0], args.slice(1), options);
	readline.createInterface(proc.stdout).on('line', (line: string) => log.info(line));
	readline.createInterface(proc.stderr).on('line', (line: string) => log.error(line));
	return await proc;
}

/**
 * Converts a windows host path into a *nix friendly path for use inside a container
 */
function nixPath(input: string) {
	let output = input;
	if (output.substr(1, 2) === ':\\') {
		output = output.substr(2);
	}
	output = output.replace(/\\/g, '/');
	return output;
}

/**
 * Swallows the "no such file or directory" error when thrown.
 */
async function unlinkIfExists(log: Logger, path: string) {
	try {
		await fs.promises.unlink(path);
		log.info(`deleted ${path}`);
	} catch (e) {
		if (!e.message.includes('no such file or directory')) {
			throw e;
		}
	}
}

// >>> TASKS
// -----------------------------------------------------------------------------
export async function prepareRelease() {
	const log = logger.getChildLogger({ prefix: ['prepareRelease:'] });

	await fs.promises.rmdir('./dist', { recursive: true });
	log.info('rm -rf ./dist');
	await fs.promises.mkdir('./dist/github-downloads', { recursive: true });
	log.info('mkdir -p ./dist/github-downloads');

	async function build(os: 'linux' | 'darwin' | 'windows') {
		await exe(log.getChildLogger({ prefix: ['go', 'build', os] }),
			['go', 'build',
				'-ldflags', `-X main.versionNo=${config.versionNo} -X main.commitUrl=${config.commitUrl} -X main.date=${config.date}`,
				'-o', `./dist/ssh_add_with_pass_${os}_amd64`,
				'.',
			], {
			env: {
				'CGO_ENABLED': '0',
				'GOOS': os,
				'GOARCH': 'amd64'
			},
		}
		);
		log.info(`built ./dist/ssh_add_with_pass_${os}_amd64`);

		await Promise.all([
			(async () => {
				const a = archiver(os === 'windows' ? 'zip' : 'tar', { gzip: true });
				a.append(fs.createReadStream('./README.md'), { name: 'README.md' });
				a.append(fs.createReadStream('./CHANGELOG.md'), { name: 'CHANGELOG.md' });
				a.append(fs.createReadStream('./LICENSE'), { name: 'LICENSE' });
				a.append(fs.createReadStream(`./dist/ssh_add_with_pass_${os}_amd64`), { name: os === 'windows' ? 'ssh_add_with_pass.exe' : 'ssh_add_with_pass' });
				a.pipe(fs.createWriteStream(`./dist/github-downloads/ssh_add_with_pass_${os}_amd64.${os === 'windows' ? 'zip' : 'tar.gz'}`));
				await a.finalize();
				log.info(`packaged ./dist/github-downloads/ssh_add_with_pass_${os}_amd64.${os === 'windows' ? 'zip' : 'tar.gz'}`);
			})(),
			(async () => {
				if (os === 'linux') {
					await exe(
						log.getChildLogger({ prefix: ['nfpm'] }),
						['docker', 'pull', `goreleaser/nfpm:v${config.nfpmVersion}`]
					);

					const nfpm = (type: 'rpm' | 'deb' | 'apk') => exe(
						log.getChildLogger({ prefix: [`nfpm(${type}):`] }),
						[
							'docker', 'run', '--rm',
							'-v', `${__dirname}:${nixPath(__dirname)}`,
							'-w', nixPath(__dirname),
							'-e', `VERSION=${config.versionNo}`,
							`goreleaser/nfpm:v${config.nfpmVersion}`,
							'pkg', '--target', `./dist/github-downloads/ssh_add_with_pass_linux_amd64.${type}`,
						]
					);

					await Promise.all([
						nfpm('apk'),
						nfpm('rpm'),
						nfpm('deb'),
					]);
				}
			})(),
		]);
	}

	await Promise.all([
		build('linux'),
		build('darwin'),
		build('windows'),
	]);

	let checksumFile = '';
	for (let file of await fs.promises.readdir('./dist/github-downloads')) {
		const hash = await hasha.fromFile(`./dist/github-downloads/${file}`, { algorithm: 'sha256' });
		checksumFile = `${checksumFile}${hash}  ${file}\n`
	}
	await fs.promises.writeFile('./dist/github-downloads/sha256_checksums.txt', checksumFile, 'utf8');
	log.info('written ./dist/github-downloads/sha256_checksums.txt');

	await fs.promises.mkdir('./dist/homebrew-tap', { recursive: true });
	log.info('mkdir -p ./dist/homebrew-tap');
	let brew = await fs.promises.readFile('./brew.rb', 'utf8');
	brew = brew.replace(/\$\{VERSION\}/g, config.versionNo);
	brew = brew.replace(/\$\{HASH\}/g, await hasha.fromFile('./dist/github-downloads/ssh_add_with_pass_darwin_amd64.tar.gz', { algorithm: 'sha256' }));
	await fs.promises.writeFile('./dist/homebrew-tap/ssh_add_with_pass.rb', brew, 'utf8');
	log.info('written ./dist/homebrew-tap/ssh_add_with_pass.rb');

	await fs.promises.mkdir('./dist/scoop-bucket', { recursive: true });
	log.info('mkdir -p ./dist/scoop-bucket');
	let scoop = await fs.promises.readFile('./scoop.json', 'utf8');
	scoop = scoop.replace(/\$\{VERSION\}/g, config.versionNo);
	scoop = scoop.replace(/\$\{HASH\}/g, await hasha.fromFile('./dist/github-downloads/ssh_add_with_pass_windows_amd64.zip', { algorithm: 'sha256' }));
	await fs.promises.writeFile('./dist/scoop-bucket/ssh_add_with_pass.json', scoop, 'utf8');
	log.info('written ./dist/scoop-bucket/ssh_add_with_pass.json');
}

export async function publishRelease() {
	const log = logger.getChildLogger({ prefix: ['publishRelease:'] });

	await Promise.all([
		(async () => {
			const brewLog = log.getChildLogger({ prefix: ['brew:'] });
			await git.clone({fs, http: gitHttp,
				url: 'https://github.com/brad-jones/homebrew-tap.git',
				dir: './dist/homebrew-tap/repo',
				onAuth: (url) => ({ username: 'token', password: config.githubToken }),
				onMessage: (msg) => { brewLog.info(msg.trim()) }
			});
			await unlinkIfExists(brewLog, './dist/homebrew-tap/repo/Formula/ssh_add_with_pass.rb');
			await fs.promises.copyFile('./dist/homebrew-tap/ssh_add_with_pass.rb', './dist/homebrew-tap/repo/Formula/ssh_add_with_pass.rb');
			brewLog.info('copied ./dist/homebrew-tap/ssh_add_with_pass.rb => ./dist/homebrew-tap/repo/Formula/ssh_add_with_pass.rb');
			await git.add({fs, dir: './dist/homebrew-tap/repo', filepath: 'Formula/ssh_add_with_pass.rb'});
			brewLog.info('git add ./dist/homebrew-tap/repo/Formula/ssh_add_with_pass.rb');
			await git.commit({fs, dir: './dist/homebrew-tap/repo', message: `chore(ssh_add_with_pass): release new version ${config.versionNo}`, author: {name: 'semantic-release-bot', email: 'semantic-release-bot@martynus.net'}});
			brewLog.info(`git commit -m "chore(ssh_add_with_pass): release new version ${config.versionNo}"`);
			brewLog.info('git push origin master -C ./dist/homebrew-tap/repo');
			await git.push({fs, http: gitHttp, dir: './dist/homebrew-tap/repo', remote: 'origin', ref: 'master',
				onAuth: (url) => ({ username: 'token', password: config.githubToken }),
				onMessage: (msg) => { brewLog.info(msg.trim()) }
			});
		})(),
		(async () => {
			const scoopLog = log.getChildLogger({ prefix: ['scoop:'] });
			await git.clone({fs, http: gitHttp,
				url: 'https://github.com/brad-jones/scoop-bucket.git',
				dir: './dist/scoop-bucket/repo',
				onAuth: (url) => ({ username: 'token', password: config.githubToken }),
				onMessage: (msg) => { scoopLog.info(msg.trim()) }
			});
			await unlinkIfExists(scoopLog, './dist/scoop-bucket/repo/ssh_add_with_pass.json');
			await fs.promises.copyFile('./dist/scoop-bucket/ssh_add_with_pass.json', './dist/scoop-bucket/repo/ssh_add_with_pass.json');
			scoopLog.info('copied ./dist/scoop-bucket/ssh_add_with_pass.json => ./dist/scoop-bucket/repo/ssh_add_with_pass.json');
			await git.add({fs, dir: './dist/scoop-bucket/repo', filepath: 'ssh_add_with_pass.json'});
			scoopLog.info('git add ./dist/scoop-bucket/repo/ssh_add_with_pass.json');
			await git.commit({fs, dir: './dist/scoop-bucket/repo', message: `chore(ssh_add_with_pass): release new version ${config.versionNo}`, author: {name: 'semantic-release-bot', email: 'semantic-release-bot@martynus.net'}});
			scoopLog.info(`git commit -m "chore(ssh_add_with_pass): release new version ${config.versionNo}"`);
			scoopLog.info('git push origin master -C ./dist/scoop-bucket/repo');
			await git.push({fs, http: gitHttp, dir: './dist/scoop-bucket/repo', remote: 'origin', ref: 'master',
				onAuth: (url) => ({ username: 'token', password: config.githubToken }),
				onMessage: (msg) => { scoopLog.info(msg.trim()) }
			});
		})(),
	]);
}

// >>> ENTRYPOINT
// -----------------------------------------------------------------------------
module.exports[config._[0]].apply(null);
