# 언리얼로 비전프로 빌드 — 런처 엔진으로는 안 됨

- 기록: 2026-08-25
- 분야: Unreal Engine, visionOS

## 문제

UE 5.8.1(에픽 런처 설치판)로 비전프로 앱을 바로 만들 수 있는지 확인 필요했음.

## 원인

- 런처 배포판에는 visionOS SDK/플랫폼 파일이 미포함 → "The VisionOS platform is not supported from this engine distribution" 에러.
- visionOS 지원은 5.4부터 엔진 소스에는 있지만 여전히 Experimental이고, 5.8 릴리즈 노트에도 언급 없음(방치 상태).

## 해결 (진행 경로)

1. Epic 계정 ↔ GitHub 계정 연동 (비공개 UnrealEngine 저장소 접근 권한 획득)
2. **Apple Silicon Mac**에서 `EpicGames/UnrealEngine` 5.8 release 브랜치 clone
3. `Setup.sh` → `GenerateProjectFiles.sh` → Xcode로 엔진 컴파일 (수 시간, 디스크 150~200GB)
4. 소스빌드 에디터로 프로젝트 열고 visionOS 패키징
- 워크플로우: 윈도우에서 콘텐츠 작업 → Mac 소스빌드 엔진으로 패키징
- 완전 VR은 시도 가능. 구역 트리거 MR(월드 앵커·이미지 트래킹)은 UE에 노출 안 됨 → Unity(PolySpatial) 또는 네이티브가 현실적

## 참고

- 2026-06 애플이 visionOS 27과 함께 언리얼용 ARKit·공간 컨트롤러·PHASE 플러그인을 깃허브에 공개 — 올가을 정식 이후 UE 경로가 넓어질 수 있음
