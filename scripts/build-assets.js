import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, copyFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const root = process.cwd();
const output = resolve(root, '.dist');
if (output !== join(root, '.dist')) throw new Error('정적 파일 출력 경로를 확인해 주세요.');

await rm(output, { recursive: true, force: true });
await cp(join(root, 'public'), output, { recursive: true });
await mkdir(join(output, 'manual'), { recursive: true });
await copyFile(join(root, 'manual', 'index.html'), join(output, 'manual', 'index.html'));
await cp(join(root, 'manual', 'assets'), join(output, 'manual', 'assets'), { recursive: true });

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  }));
  return files.flat();
}

// 배포되는 파일 내용이 하나라도 바뀌면 서비스 워커의 캐시 이름도 바뀌어 예전 캐시를 지운다.
const hash = createHash('sha256');
for (const file of (await listFiles(output)).sort()) {
  hash.update(relative(output, file));
  hash.update(await readFile(file));
}
const buildHash = hash.digest('hex').slice(0, 12);
const swPath = join(output, 'sw.js');
const worker = await readFile(swPath, 'utf8');
if (!worker.includes('__BUILD_HASH__')) throw new Error('sw.js에 __BUILD_HASH__ 자리 표시자가 없습니다.');
await writeFile(swPath, worker.replaceAll('__BUILD_HASH__', buildHash));

console.log(`교실 화면과 사용설명서를 .dist에 준비했습니다. (캐시 버전 ${buildHash})`);
