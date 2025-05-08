import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

import { addDependencyToPackageJson, findPackageJson } from "./codes";
import { WorkspaceExplorer, WorkspacePackage } from "./explorer";

export function activate(context: vscode.ExtensionContext) {
  // 1. 설정 가져오기
  const config = vscode.workspace.getConfiguration();
  const customPackagePrefix = config.get<string>(
    "customPackagePrefix",
    "@wrtn"
  );

  // 2. CodeActionsProvider 등록
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { pattern: "**/*.{ts,js,tsx,jsx}", scheme: "file" },
      {
        provideCodeActions: (document, range, context, token) => {
          const lineText = document.lineAt(range.start.line).text;
          const importMatch = lineText.match(
            new RegExp(
              `import\\s+.*\\s+from\\s+['"](${customPackagePrefix}\/[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*)['"]`
            )
          );

          if (!importMatch) {
            return;
          }

          const packageName = importMatch[1];
          const command: vscode.Command = {
            title: "Add to package.json and install",
            command: "extension.addDependency",
            arguments: [document.uri.fsPath, packageName],
          };

          const action = new vscode.CodeAction(
            command.title,
            vscode.CodeActionKind.QuickFix
          );
          action.command = command;
          return [action];
        },
      },
      {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "extension.addDependency",
      async (filePath: string, packageName: string) => {
        const packageJsonPath = findPackageJson(filePath);
        if (!packageJsonPath) {
          vscode.window.showErrorMessage(
            "No package.json found in the workspace."
          );
          return;
        }
        addDependencyToPackageJson(packageJsonPath, packageName);

        const terminal = vscode.window.createTerminal();
        terminal.sendText(`pnpm install`);
        terminal.show();
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "extension.installAllDependencies",
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showErrorMessage("No active editor found.");
          return;
        }

        const document = editor.document;
        const text = document.getText();
        const importRegex = new RegExp(
          `import\\s+.*\\s+from\\s+['"](${customPackagePrefix}\/[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*)['"]`,
          "g"
        );
        let match;

        const packageJsonPath = findPackageJson(document.uri.fsPath);
        if (!packageJsonPath) {
          vscode.window.showErrorMessage(
            "No package.json found in the workspace."
          );
          return;
        }

        while ((match = importRegex.exec(text)) !== null) {
          const packageName = match[1];
          addDependencyToPackageJson(packageJsonPath, packageName);
        }

        const terminal = vscode.window.createTerminal();
        terminal.sendText(document.fileName);
        terminal.sendText(`pnpm install`);
        terminal.show();
      }
    )
  );

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { pattern: "**/*.{ts,js,tsx,jsx}", scheme: "file" },
      {
        async provideCompletionItems(document, position, token, context) {
          // 현재 라인의 텍스트 가져오기
          const lineText = document.lineAt(position.line).text;
          const linePrefix = lineText.substring(0, position.character);

          // 워크스페이스 패키지 목록 가져오기
          const workspaceRoot =
            vscode.workspace.workspaceFolders?.[0].uri.fsPath;
          if (!workspaceRoot) return undefined;

          const workspaceExplorer = new WorkspaceExplorer(workspaceRoot);
          let packages = workspaceExplorer.getCachedPackages();
          if (packages.length === 0) {
            packages = await workspaceExplorer.getPackages();
          }

          // 시나리오 1: "import" 단어만 입력된 상태
          const importOnlyPattern = /^(\s*)import(\s*)$/;
          const importOnlyMatch = linePrefix.match(importOnlyPattern);

          // 시나리오 2: "import ... from '@" 까지 입력된 상태
          const importFromPattern =
            /^(\s*)import\s+(?:{[^}]*}|\S+)\s+from\s+(['"])@/;
          const importFromMatch = linePrefix.match(importFromPattern);

          // 시나리오 2-1: "import ... from "패키지경로일부" 까지 입력된 상태 (패키지명 부분 완성)
          const importPartialPattern =
            /^(\s*)import\s+(?:{[^}]*}|\S+)\s+from\s+(['"])(@[a-zA-Z0-9_\/-]+)/;
          const importPartialMatch = linePrefix.match(importPartialPattern);

          // 시나리오 3: "import ... from \"" 또는 "import ... from '" 까지 입력된 상태 (따옴표 있음)
          const importFromQuotePattern =
            /^(\s*)import\s+(?:{[^}]*}|\S+)\s+from\s+(['"])$/;
          const importFromQuoteMatch = linePrefix.match(importFromQuotePattern);

          // 시나리오 4: "import ... from " 까지 입력된 상태 (따옴표 없음)
          const importFromSpacePattern =
            /^(\s*)import\s+(?:{[^}]*}|\S+)\s+from\s+$/;
          const importFromSpaceMatch = linePrefix.match(importFromSpacePattern);

          // 시나리오 5: "import ... from" 까지 입력된 상태 (공백 없음)
          const importFromNoSpacePattern =
            /^(\s*)import\s+(?:{[^}]*}|\S+)\s+from$/;
          const importFromNoSpaceMatch = linePrefix.match(
            importFromNoSpacePattern
          );

          // 기존의 일반적인 import 문맥 감지
          const isImportContext =
            linePrefix.includes("import") || linePrefix.includes("from");

          // 어떤 패턴에도 맞지 않으면서 import 문맥이 아니면 종료
          if (
            !importOnlyMatch &&
            !importFromMatch &&
            !importPartialMatch && // 새 패턴 추가
            !importFromQuoteMatch &&
            !importFromSpaceMatch &&
            !importFromNoSpaceMatch &&
            !isImportContext
          ) {
            return undefined;
          }

          // 패키지 필터링 (부분 입력된 경우 해당 패키지만 표시)
          let filteredPackages = packages;
          let partialPackagePath = "";

          // 1. 현재 작업 중인 파일의 패키지 정보를 가져옴
          const currentFilePath = document.uri.fsPath;
          const packageJsonPath = findPackageJson(currentFilePath);
          let currentPackageName = "";
          let currentPackageDomain = "";

          if (packageJsonPath) {
            try {
              const packageJsonContent = fs.readFileSync(
                packageJsonPath,
                "utf8"
              );
              const packageJson = JSON.parse(packageJsonContent);
              currentPackageName = packageJson.name || "";

              // 현재 패키지의 도메인 추출
              if (currentPackageName.startsWith("@")) {
                const parts = currentPackageName.split("/");
                if (parts.length >= 3) {
                  // @wrtn/chat2/feature-home 형식 - 도메인은 두번째 부분 (chat2)
                  currentPackageDomain = parts[1];
                }
              }
            } catch (error) {
              console.error("패키지 정보 읽기 실패:", error);
            }
          }

          // 2. 입력된 상태에 따라 패키지 필터링
          if (importPartialMatch) {
            partialPackagePath = importPartialMatch[3]; // 이미 입력된 패키지 경로 부분
            filteredPackages = packages.filter((pkg) =>
              pkg.name.startsWith(partialPackagePath)
            );
          } else if (importFromMatch) {
            // @ 다음에 오는 패키지들만 필터링
            filteredPackages = packages.filter((pkg) =>
              pkg.name.startsWith("@")
            );
          }

          // 3. 현재 패키지 도메인과 동일한 패키지 또는 공용 라이브러리 패키지만 필터링
          if (currentPackageDomain && filteredPackages.length > 0) {
            filteredPackages = filteredPackages.filter((pkg) => {
              // 패키지 이름에서 도메인 추출
              if (!pkg.name.startsWith("@")) return false;

              const parts = pkg.name.split("/");

              // 공용 라이브러리 패키지인 경우 (2단계 구조: @wrtn/utils-env2)
              if (parts.length === 2) {
                return true; // 공용 라이브러리는 항상 허용
              }

              // 동일 도메인 패키지인 경우 (3단계 구조: @wrtn/chat2/feature-home)
              if (parts.length >= 3) {
                const pkgDomain = parts[1];
                return pkgDomain === currentPackageDomain; // 현재 패키지와 동일한 도메인만 허용
              }

              return false;
            });
          }
          return filteredPackages.map((pkg) => {
            const completionItem = new vscode.CompletionItem(
              pkg.name,
              vscode.CompletionItemKind.Module
            );
            completionItem.detail = pkg.type;
            completionItem.documentation = pkg.path;

            // 시나리오 1: "import" 단어만 있는 경우 전체 import 문 삽입
            if (importOnlyMatch) {
              // 커서 위치를 {} 사이에 두기 위한 스니펫 설정
              const snippetString = new vscode.SnippetString(
                `{ $1 } from "${pkg.name}";`
              );
              completionItem.insertText = snippetString;

              // 현재 줄의 "import" 다음 위치부터 대체
              const importKeywordLength = "import".length;
              const startPos = new vscode.Position(
                position.line,
                importOnlyMatch[1].length + importKeywordLength
              );
              const endPos = position;
              completionItem.range = new vscode.Range(startPos, endPos);
            }
            // 시나리오 2-1: 패키지명 부분 입력된 경우 (새로 추가)
            else if (importPartialMatch) {
              const quoteType = importPartialMatch[2]; // 사용된 따옴표 타입 ('또는 ")

              // 이미 입력된 부분을 제외한 나머지만 삽입 (따옴표는 이미 있으므로 포함하지 않음)
              const remainingPart = pkg.name.substring(
                partialPackagePath.length
              );
              completionItem.insertText = remainingPart;

              // 이미 입력된 부분 이후부터 현재 위치까지 대체
              const startPos = position;
              const endPos = position;
              completionItem.range = new vscode.Range(startPos, endPos);
            }
            // 시나리오 2: "import ... from '@" 까지 입력된 경우
            else if (importFromMatch) {
              const quoteType = importFromMatch[2]; // 사용된 따옴표 타입 ('또는 ")

              // @ 이미 입력된 경우 고려해서 패키지명에서 @ 제거
              const insertText = pkg.name.startsWith("@")
                ? pkg.name.substring(1)
                : pkg.name;
              completionItem.insertText = insertText;

              // 따옴표 다음 위치부터 대체
              const quotePos = linePrefix.lastIndexOf(quoteType);
              const atSignPos = linePrefix.lastIndexOf("@");

              // @ 기호가 따옴표 안에 있는 경우에만 시작 위치를 @ 위치로 설정
              const startPos =
                atSignPos > quotePos
                  ? new vscode.Position(position.line, atSignPos + 1) // @ 다음부터
                  : new vscode.Position(position.line, quotePos + 1); // 따옴표 다음부터

              const endPos = position;
              completionItem.range = new vscode.Range(startPos, endPos);
            }
            // 시나리오 3: 이미 따옴표가 있는 경우 (따옴표 중복 방지)
            else if (importFromQuoteMatch) {
              const quoteType = importFromQuoteMatch[2]; // 사용된 따옴표 타입 ('또는 ")
              completionItem.insertText = `${pkg.name}`; // 따옴표 없이 패키지명만 삽입

              const quotePos = linePrefix.lastIndexOf(quoteType);
              const startPos = new vscode.Position(position.line, quotePos + 1); // 따옴표 다음 위치
              const endPos = position;
              completionItem.range = new vscode.Range(startPos, endPos);
            }
            // 시나리오 4: "import ... from " 까지 입력된 경우 (따옴표 없음)
            else if (importFromSpaceMatch) {
              completionItem.insertText = `"${pkg.name}"`; // 따옴표와 함께 패키지명 삽입

              const fromPos = linePrefix.lastIndexOf("from") + 4; // "from" 다음 위치
              const startPos = new vscode.Position(position.line, fromPos + 1); // 공백 다음
              const endPos = position;
              completionItem.range = new vscode.Range(startPos, endPos);
            }
            // 시나리오 5: "import ... from" 까지 입력된 경우 (공백 없음)
            else if (importFromNoSpaceMatch) {
              completionItem.insertText = ` "${pkg.name}"`; // 공백과 따옴표를 포함하여 삽입

              const startPos = new vscode.Position(
                position.line,
                linePrefix.length
              );
              const endPos = position;
              completionItem.range = new vscode.Range(startPos, endPos);
            }
            // 기본 동작: 패키지 이름만 삽입
            else {
              completionItem.insertText = `'${pkg.name}'`;
            }

            return completionItem;
          });
        },
      },
      // 트리거 문자 지정
      "'",
      '"',
      "/",
      " ",
      "@"
    )
  );

  // View Provider 등록

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;

  if (workspaceRoot) {
    const workspaceExplorer = new WorkspaceExplorer(workspaceRoot);
    vscode.window.registerTreeDataProvider(
      "pnpmWorkspaceView",
      workspaceExplorer
    );
  }

  const outputChannel = vscode.window.createOutputChannel("PNPM Workspace");

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "pnpmWorkspace.copyPackageName",
      (item: WorkspacePackage) => {
        // 디버그 로깅
        outputChannel.appendLine("복사 커맨드 실행됨");
        outputChannel.appendLine("전달된 item:");
        outputChannel.appendLine(JSON.stringify(item, null, 2));

        const packageName = item.name;
        outputChannel.appendLine(`패키지명: ${packageName}`);

        if (packageName) {
          vscode.env.clipboard.writeText(`"${packageName}"`);
          vscode.window.showInformationMessage(
            `패키지명 "${packageName}" 복사됨`
          );
        }
      }
    )
  );
}
