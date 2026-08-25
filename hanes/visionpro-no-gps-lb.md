# 비전프로로 위치기반(LB) 콘텐츠 — GPS가 없다

- 기록: 2026-08-25
- 분야: Apple Vision Pro, 위치기반 콘텐츠

## 문제

유적지 구역별로 애니메이션이 재생되는 극 형태 콘텐츠를 비전프로로 만들고 싶은데, "이 GPS 좌표에 가면 재생" 방식이 되는지 불명확했음.

## 원인 (기기 한계)

- 비전프로에는 **GPS·지자기(나침반) 센서가 없음**. CoreLocation은 Wi-Fi 기반 오차 ~100m (근처에 iPhone 있으면 iPhone GPS를 빌려 수 m).
- 즉 야외 좌표 기반 트리거는 단독으로 불가. 방위(어느 쪽을 보는지)도 API로 제공 안 됨.

## 해결 (설계 방향)

- 공간 인식 기반으로 전환: **WorldAnchor**(공간에 저장·재방문 시 복원) + **DeviceAnchor**(사용자 머리 위치 매 프레임) 조합으로 구역 트리거 구현. Full Space(ImmersiveSpace) 모드 필수.
- 시작 방향 무관하게 만들려면 콘텐츠를 앱 시작 좌표가 아니라 앵커/마커에 고정.
- 넓은 부지·여러 구역은 **이미지 마커(ImageTrackingProvider)** 를 구역 입구에 배치해 재정렬.
- 상태 머신으로 극 진행 관리 (A→B→A 재방문 시 C 등장 같은 연출 가능).
- 멀티유저 동기화는 visionOS 26 공유 공간 경험 / SharedCoordinateSpaceProvider(엔터프라이즈 API), 또는 마커 기반 각자 정렬.
- 장소 판별(어느 유적지인지)은 iPhone 연동 위치로, 장소 안 극 진행은 ARKit로 역할 분담.

## 참고

- WWDC23 "Meet ARKit for spatial computing", visionOS 26 발표 (2025-06)
- 주의: WorldAnchor 복원이 기기 위치 기준으로 어긋나는 리포트 있음 — 상설 전시는 마커 보조 필수
