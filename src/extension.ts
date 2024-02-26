import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

function findPackageJson(filePath: string): string | null {
  let dir = path.dirname(filePath);
  while (dir !== path.dirname(dir)) {
    const packageJsonPath = path.join(dir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      return packageJsonPath;
    }
    dir = path.dirname(dir);
  }
  return null;
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { pattern: "**/*.{ts,js,tsx,jsx}", scheme: "file" },
      {
		provideCodeActions: (document, range, context, token) => {
			const lineText = document.lineAt(range.start.line).text;
			const importMatch = lineText.match(/import\s+.*\s+from\s+'(@wrtn\/[a-zA-Z0-9_-]+)'/);
			if (!importMatch) {
				return;
			}
		
			const packageName = importMatch[1];
			const command: vscode.Command = {
				title: 'Add to package.json and install',
				command: 'extension.addDependency',
				arguments: [document.uri.fsPath, packageName],
			};
		
			const action = new vscode.CodeAction(command.title, vscode.CodeActionKind.QuickFix);
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

        const packageJson = JSON.parse(
          fs.readFileSync(packageJsonPath, "utf-8")
        );

        if (!packageJson.dependencies) {
          packageJson.dependencies = {};
        }

        if (!packageJson.dependencies[packageName]) {
          packageJson.dependencies[packageName] = "workspace:*";
          fs.writeFileSync(
            packageJsonPath,
            JSON.stringify(packageJson, null, 2),
            "utf-8"
          );

          const terminal = vscode.window.createTerminal();
          terminal.sendText(
            `pnpm install`
          );
          terminal.show();
        }
      }
    )
  );
}

export function deactivate() {}
