import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

interface WorkspacePackage {
  name: string;
  path: string;
  children?: WorkspacePackage[];
  type: "directory" | "package";
}

export class WorkspaceExplorer
  implements vscode.TreeDataProvider<WorkspacePackage>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    WorkspacePackage | undefined | null | void
  > = new vscode.EventEmitter<WorkspacePackage | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    WorkspacePackage | undefined | null | void
  > = this._onDidChangeTreeData.event;

  constructor(private workspaceRoot: string) {}

  getTreeItem(element: WorkspacePackage): vscode.TreeItem {
    const treeItem = new vscode.TreeItem(
      element.name,
      element.children && element.children.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    if (element.type === "package") {
      // 더블클릭 시 package.json 열기
      treeItem.command = {
        command: "vscode.open",
        title: "Open Package.json",
        arguments: [vscode.Uri.file(path.join(element.path, "package.json"))],
      };

      // 패키지 아이템에 대한 툴팁 설정
      const tooltip = new vscode.MarkdownString();
      tooltip.supportHtml = true;
      tooltip.appendMarkdown(`### ${element.name}\n\n`);
      tooltip.appendMarkdown(`📁 ${element.path}\n\n`);
      tooltip.appendMarkdown(
        `$(copy) [패키지명 복사](command:pnpmWorkspace.copyPackageName?${encodeURIComponent(
          JSON.stringify([element.name])
        )})`
      );
      tooltip.isTrusted = true;

      treeItem.tooltip = tooltip;
      treeItem.contextValue = "package";
    } else {
      treeItem.tooltip = element.path;
    }

    treeItem.iconPath =
      element.type === "directory"
        ? new vscode.ThemeIcon("folder")
        : new vscode.ThemeIcon("package");

    return treeItem;
  }

  async getChildren(element?: WorkspacePackage): Promise<WorkspacePackage[]> {
    if (!this.workspaceRoot) {
      return [];
    }

    if (element) {
      return element.children || [];
    }

    return this.getWorkspacePackages();
  }

  private sortPackages(packages: WorkspacePackage[]): WorkspacePackage[] {
    return packages.sort((a, b) => {
      // 디렉토리를 먼저 정렬
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }
      // 같은 타입끼리는 이름순으로 정렬
      return a.name.localeCompare(b.name);
    });
  }

  private async getWorkspacePackages(): Promise<WorkspacePackage[]> {
    const workspaceYamlPath = path.join(
      this.workspaceRoot,
      "pnpm-workspace.yaml"
    );

    try {
      const yamlContent = fs.readFileSync(workspaceYamlPath, "utf8");
      const workspaceConfig = yaml.load(yamlContent) as { packages: string[] };
      const packages: WorkspacePackage[] = [];

      for (const pkgPattern of workspaceConfig.packages) {
        const pkgPaths = await vscode.workspace.findFiles(
          pkgPattern + "/**/package.json",
          "**/node_modules/**"
        );

        const packageTree: { [key: string]: WorkspacePackage } = {};

        for (const pkgJsonUri of pkgPaths) {
          try {
            const pkgJsonContent = fs.readFileSync(pkgJsonUri.fsPath, "utf8");
            const pkgJson = JSON.parse(pkgJsonContent);
            const pkgPath = path.dirname(pkgJsonUri.fsPath);
            const relativePath = path.relative(this.workspaceRoot, pkgPath);
            const pathParts = relativePath.split(path.sep);

            let currentPath = "";
            let currentParent: WorkspacePackage | null = null;

            // 경로의 각 부분을 순회하며 트리 구조 생성
            for (let i = 0; i < pathParts.length; i++) {
              const part = pathParts[i];
              currentPath = currentPath ? path.join(currentPath, part) : part;
              const fullPath = path.join(this.workspaceRoot, currentPath);

              if (!packageTree[currentPath]) {
                const isLastPart = i === pathParts.length - 1;
                const newNode: WorkspacePackage = {
                  name: isLastPart ? pkgJson.name : part,
                  path: fullPath,
                  children: [],
                  type: isLastPart ? "package" : "directory",
                };
                packageTree[currentPath] = newNode;

                if (currentParent) {
                  currentParent.children?.push(newNode);
                  // 추가할 때마다 children 정렬
                  if (currentParent.children) {
                    currentParent.children = this.sortPackages(
                      currentParent.children
                    );
                  }
                } else {
                  packages.push(newNode);
                }
              }
              currentParent = packageTree[currentPath];
            }
          } catch (error) {
            console.error(
              `패키지 처리 중 오류 발생: ${pkgJsonUri.fsPath}`,
              error
            );
          }
        }
      }

      return this.sortPackages(packages);
    } catch (error) {
      vscode.window.showErrorMessage(`워크스페이스 패키지 로딩 실패: ${error}`);
      return [];
    }
  }
}
