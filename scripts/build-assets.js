import { cp, mkdir, rm, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = process.cwd();
const output = resolve(root, '.dist');
if (output !== join(root, '.dist')) throw new Error('정적 파일 출력 경로를 확인해 주세요.');

await rm(output, { recursive: true, force: true });
await cp(join(root, 'public'), output, { recursive: true });
await mkdir(join(output, 'manual'), { recursive: true });
await copyFile(join(root, 'manual', 'index.html'), join(output, 'manual', 'index.html'));
await cp(join(root, 'manual', 'assets'), join(output, 'manual', 'assets'), { recursive: true });

console.log('교실 화면과 사용설명서를 .dist에 준비했습니다.');
