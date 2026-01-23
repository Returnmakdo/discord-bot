# 프로젝트 메모

## 배포 방법
Railway 수동 배포 사용 (GitHub 자동 배포 안 됨):
```bash
git add . && git commit -m "메시지" && git push origin main && railway up -s "쌀숭이서버"
```

## 버전 관리
시맨틱 버전 태그 사용:
- 기능 추가: `v1.X.0` (minor)
- 버그 수정: `v1.0.X` (patch)
- 큰 변경: `vX.0.0` (major)
- 배포 시 `package.json` version도 함께 업데이트
- git tag: `git tag v1.3.0 && git push origin --tags`
