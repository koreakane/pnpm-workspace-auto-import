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
