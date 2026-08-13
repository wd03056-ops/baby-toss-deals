/**
 * 앱인토스 제출용 빌드
 * 1) Next 정적보내기 → out/ (index.html 포함)
 * 2) ait build → <appName>.ait
 *
 * Route Handlers(app/api)는 static export와 공존할 수 없어
 * 빌드 중에만 잠시 제외했다가 복구합니다.
 * 토스 WebView에서는 NEXT_PUBLIC_API_BASE_URL 로 API 서버를 지정하세요.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(root, "app", "api");
const stashDir = path.join(root, ".ait-build-stash", "api");
const stashParent = path.join(root, ".ait-build-stash");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      AIT_BUILD: "1",
    },
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function stashApiRoutes() {
  if (!existsSync(apiDir)) return false;
  rmSync(stashParent, { recursive: true, force: true });
  mkdirSync(stashParent, { recursive: true });
  // Windows 파일 잠금 대비: rename 대신 copy + remove
  cpSync(apiDir, stashDir, { recursive: true });
  rmSync(apiDir, { recursive: true, force: true });
  return true;
}

function restoreApiRoutes(stashed) {
  if (!stashed) return;
  if (existsSync(apiDir)) {
    rmSync(apiDir, { recursive: true, force: true });
  }
  if (existsSync(stashDir)) {
    mkdirSync(path.dirname(apiDir), { recursive: true });
    cpSync(stashDir, apiDir, { recursive: true });
  }
  rmSync(stashParent, { recursive: true, force: true });
}

let stashed = false;
try {
  stashed = stashApiRoutes();
  console.log("[build-ait] next build (static export → out/)");
  run("npx", ["next", "build"]);
  console.log("[build-ait] ait build (.ait 아티팩트 생성)");
  run("npx", ["ait", "build"]);
  console.log("[build-ait] 완료 — 프로젝트 루트의 <appName>.ait 를 확인하세요.");
} catch (error) {
  console.error("[build-ait] 실패", error);
  process.exit(1);
} finally {
  restoreApiRoutes(stashed);
}
