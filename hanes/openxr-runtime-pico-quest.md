# Quest로 테스트가 안 됨 — 활성 OpenXR 런타임이 PICO

- 기록: 2026-08 (이전 발생 건 정리)
- 분야: VR, OpenXR, Unreal (GH_HMD_260818)

## 문제

언리얼 VR 프로젝트(GH_HMD_260818, UE 5.8 고정 — 5.7 불가)를 Quest로 돌리려는데 HMD가 안 잡히거나 PICO 쪽으로만 붙음.

## 원인

윈도우의 **활성 OpenXR 런타임이 PICO**로 설정돼 있음. OpenXR 런타임은 시스템 전역에서 하나만 활성이라, PICO가 잡고 있으면 Quest(Oculus/Meta 런타임)가 못 붙는다.

## 해결

- Quest 테스트 전에 **Meta(Oculus) 앱에서 "활성 OpenXR 런타임으로 설정"** 으로 전환.
- PICO 테스트로 돌아갈 땐 PICO 앱에서 다시 전환.
- HMD 인식 문제가 생기면 기기 탓하기 전에 런타임 전환 상태부터 확인.
