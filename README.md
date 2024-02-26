실행법

1. cmd + shift + p를 눌러 명령어 창을 연다.
2. Extensions: Install from VSIX를 입력하고 선택한다.
3. 설치할 vsix 파일을 선택한다.
4. 설치가 완료되면, 우하단 Reload를 클릭하여 VSCode를 재시작한다.
5. 재시작 후, cmd + shift + p를 눌러 명령어 창을 연다.
6. activate pnpm-workspace-auto-import를 입력해 활성화한다.
7. 에러 창이 뜨면 활성화가 완료된 것이다.
8. `import { fromNow } from '@wrtn/utils-date';` 같은 import 문에서 `@wrtn/utils-date`에 에러가 뜨면 커서를 두고 cmd + .를 누른다.
9. `Add to workspace import`를 선택하면, 자동으로 import가 추가된다.
10. 이제부터는 import를 직접 쓰지 않아도 된다.

미쳤다