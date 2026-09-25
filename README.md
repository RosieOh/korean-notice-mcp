# korean-notice-mcp

[![npm](https://img.shields.io/npm/v/korean-notice-mcp.svg)](https://www.npmjs.com/package/korean-notice-mcp) [![test](https://github.com/RosieOh/korean-notice-mcp/actions/workflows/test.yml/badge.svg)](https://github.com/RosieOh/korean-notice-mcp/actions/workflows/test.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

한국어 | [English](https://github.com/RosieOh/korean-notice-mcp/blob/main/README-EN.md)

**작년 공고와 올해 공고를 넣으면, 바뀐 신청조건과 준비할 서류를 원문 근거와 함께 알려주는 MCP 서버입니다.**

한국 지자체·공공기관의 모집공고(HWP, HWPX)를 AI 앱(Claude Desktop 등)에서 바로 읽게 해 줍니다. 모든 결과에는 원문 위치와 문서 해시가 붙어, 사람이 원문과 대조할 수 있습니다.

> "올해 청년동아리 공고와 작년 공고를 비교해서, 바뀐 신청조건과 내가 준비할 서류를 근거와 함께 알려줘."

![작년·올해 청년동아리 공고 비교 데모](https://raw.githubusercontent.com/RosieOh/korean-notice-mcp/main/docs/demo-compare.gif)

위 화면은 실제 공개 공고(장수군 청년동아리 2025 HWP → 2026 HWPX)를 비교한 출력을 그대로 녹화한 것입니다. 1위는 "고유번호증 또는 사업자등록증"이 필수에서 조건부로 바뀐 것, 2위는 신청기간, 3위는 신청 연령 하한이 15세에서 만 18세로 오른 것입니다. 각 항목의 근거 위치를 `get_evidence`에 넣으면 해당 원문을 다시 확인할 수 있습니다.

공식 [MCP 레지스트리](https://registry.modelcontextprotocol.io)에 `io.github.RosieOh/korean-notice-mcp`로 등록되어 있습니다.

## 빠르게 써 보기

Node.js 22 이상이 필요합니다.

```bash
# 가진 공고 두 개를 바로 비교
npx -y korean-notice-mcp compare 2025-공고.hwp 2026-공고.hwpx

# 공고 하나의 제출서류·신청기간만 보기
npx -y korean-notice-mcp checklist 2026-공고.hwpx

# 합성 예시로 MCP 도구 응답(JSON) 확인
npx -y korean-notice-mcp --demo
```

### Claude Desktop에 연결

`claude_desktop_config.json`에 추가합니다. `MCP_DATA_DIR`에는 공고 파일을 모아 둘 폴더의 절대 경로를 넣으세요. 서버는 이 폴더 안의 파일만 읽습니다.

```json
{
  "mcpServers": {
    "korean-notice": {
      "command": "npx",
      "args": ["-y", "korean-notice-mcp"],
      "env": { "MCP_DATA_DIR": "C:\\Users\\me\\Documents\\공고" }
    }
  }
}
```

연결한 뒤 폴더에 `2025-공고.hwp`, `2026-공고.hwpx`를 넣고 AI에게 두 파일을 비교해 달라고 요청하면 됩니다.

## 도구

| 도구 | 하는 일 |
|---|---|
| `extract_requirements` | 제출서류(필수/조건부와 조건 문구), 신청기간, 자격 문단 후보를 근거 위치와 함께 추출 |
| `compare_notices` | 두 공고 비교. 서류 추가·삭제·필수/조건부 변경과 신청기간 변경을 먼저, 나머지 문구·표 변경을 중요도 순으로 보여줌. 연도만 바뀐 문구는 `date_only_changes`로 분리 |
| `read_notice` | 본문과 표(행·열·병합)를 원문 위치·해시와 함께 읽기 |
| `get_evidence` | 같은 해시의 문서에서 근거 위치의 원문을 다시 확인 |

지원 형식은 HWP, HWPX, TXT, MD, CSV입니다. PDF와 스캔 이미지(OCR)는 아직 지원하지 않습니다. 모든 도구는 읽기 전용이고, 외부 네트워크에 접속하지 않습니다.

## 얼마나 정확한가

장수군이 공개한 5개 사업의 2025·2026 공고 10건(HWP 9, HWPX 1)으로 평가했습니다. 규칙은 3쌍으로만 조정했고, 나머지 2쌍은 보류해 두었다가 평가했습니다. 방법과 전체 결과는 [benchmarks/README.md](benchmarks/README.md)에 있습니다.

| | 이전 방식 | 이 버전 |
|---|---|---|
| 제출서류 재현율 / 정밀도 (전체) | 66% / 7% | 92% / 84% |
| 신청기간 적중 | 0/10 | 10/10 |
| 중요 변경 34건 중 결과 상위 15개 안 | 4 | 24 |
| 사용자가 검토할 변경 항목 수 | 1,779 | 403 |

먼저 알아 둘 한계가 있습니다.

- **보류 세트를 처음 평가했을 때 서류 재현율은 43%였습니다.** 처음 보는 표 양식 하나 때문에 한 문서의 서류를 통째로 놓쳤습니다. 원인을 고친 뒤 86%가 됐지만, 이 수치는 블라인드 결과가 아닙니다.
- **다른 지자체(군산·용인·대전) 3쌍으로 다시 블라인드 평가한 결과**: 서류 정밀도는 90%로 유지됐지만 재현율은 47%에 그쳤습니다. 군산 공고에서는 제목 표기("신청서류 (…)", "신청접수 :")를 인식하지 못해 서류와 신청기간을 전혀 찾지 못했습니다. 처음 보는 양식에 약하다는 것이 현재 가장 큰 한계입니다. 자세한 내용은 [평가 문서](benchmarks/README.md)를 보세요.
- 정답표는 AI가 원문을 대조해 만든 초안이며, 사람이 독립적으로 검수하지 않았습니다. 표본도 한 지자체의 공고뿐입니다.
- 규칙 기반이라 "구비서류 발급 방법" 같은 참고표를 서류로 읽거나, 제출서류 섹션 밖에 적힌 서류를 놓칠 수 있습니다.
- 변경의 법적 의미나 신청 자격을 판정하지 않습니다. **신청 전에는 반드시 원문 공고와 담당 부서로 확인하세요.**

## 어떻게 동작하나

1. **읽기**: HWP는 [rhwp](https://www.npmjs.com/package/@rhwp/core)(MIT)로 읽습니다. rhwp의 표 API로 셀의 행·열·병합 구조를 복원해, "제출서류 | 내용 | 발급처" 같은 표에서 서류 열과 설명 열을 구분합니다. HWPX는 자체 XML 파서로 읽습니다.
2. **추출**: "제출서류", "(접수기간)", "□ 신청대상" 같은 공고 제목 표기로 섹션을 나눕니다. 그 안에서 번호 항목, 괄호 목록, "※ … 경우 … 제출" 같은 주석에서 서류를 찾습니다. "해당자", "택 1", "~인 경우" 같은 표현으로 조건부 여부를 판단합니다.
3. **비교**: 줄 단위로 비교한 뒤, 연도만 바뀐 문구는 따로 분리하고 같은 표의 셀 변경은 하나로 묶습니다. 섹션(자격·서류·기간·금액)과 숫자·키워드 변화로 중요도를 매깁니다.

근거 위치는 두 가지입니다. HWP는 `rhwp/scanN`(rhwp 스캔 순서)이고, 같은 엔진 버전과 같은 문서 해시에서만 재현됩니다. HWPX는 `section0/paragraphN` 같은 XML 구조 위치입니다.

## 평가 재현

공고 원문은 저장소에 넣지 않았습니다. 아래 명령은 게시처에서 원문을 내려받고 SHA-256을 대조한 뒤 평가합니다.

```bash
git clone https://github.com/RosieOh/korean-notice-mcp && cd korean-notice-mcp
npm install
npm run fetch-corpus   # data/raw/에 공고 10건 저장, 해시가 다르면 중단
npm run evaluate
npm test
```

## 비슷한 프로젝트와의 차이

HWP를 AI에서 읽는 도구는 이미 좋은 것이 많습니다. 이 프로젝트는 그 위에서 **공고 한 종류를 깊게** 다룹니다.

| 프로젝트 | 잘하는 것 | 이 프로젝트와의 관계 |
|---|---|---|
| [kordoc](https://github.com/chrisryugj/kordoc) | HWP·HWPX·PDF·DOCX 파싱, 서식 채우기, 문서 비교(신구대조표) MCP | 범용 문서 파서·비교. 공고의 필수/조건부 서류, 신청기간, 변경 중요도 같은 의미 단위는 다루지 않음. PDF 공고는 kordoc 쪽이 적합 |
| [rhwp](https://github.com/edwardkim/rhwp) | HWP/HWPX 뷰어·편집기(Rust+WASM), 내장 MCP 서버 | 이 프로젝트의 HWP 파싱 엔진(`@rhwp/core`) |
| [treesoop/hwp-mcp](https://github.com/treesoop/hwp-mcp) | rhwp 기반 HWP 읽기·쓰기·변환 MCP | 범용 HWP 도구. 공고 해석 기능은 없음 |
| 나라장터·공공데이터포털 MCP 서버들 | 공고·입찰 **검색**(API) | 첨부 HWP는 읽지 않음. "검색 → 첨부 내려받기 → 이 서버로 분석"으로 함께 쓰기 좋음 |

이 프로젝트만의 부분은 세 가지입니다.

- 공고 전용 추출: 제출서류(필수/조건부와 조건 문구)와 신청기간을 뽑습니다.
- 전년 대비 변경: 연도만 바뀐 문구는 따로 분리하고, 나머지 변경을 중요도 순으로 정렬합니다.
- 공개 평가: 실제 공고와 정답표로 만든 평가 세트를 함께 공개합니다.

## 기여

다른 지자체 공고 쌍과 정답표, 특히 사람이 검수한 정답표를 가장 환영합니다. 개인정보가 들어간 실제 신청 서류는 이슈에 첨부하지 마세요. [SECURITY.md](SECURITY.md)를 참고하세요.

## 라이선스와 고지

- **코드**: MIT 라이선스입니다. HWP 파싱에는 [@rhwp/core](https://www.npmjs.com/package/@rhwp/core)(MIT, Edward Kim)를 사용합니다.
- **공고 인용 부분은 MIT 대상이 아닙니다.** `benchmarks/`의 정답표·평가 결과와 데모 이미지에는 장수군청 공개 공고의 일부 문구가 연구·평가 목적으로 인용되어 있습니다. 이 인용 부분의 권리는 원 저작자에게 있습니다. 원 게시물에는 [공공누리 제4유형](https://www.kogl.or.kr/info/license.do)(출처표시, 상업적 이용금지, 변경금지)이 표시되어 있습니다. 출처는 [benchmarks/sources.json](benchmarks/sources.json)에 있습니다. 공고 원문 파일은 이 저장소와 npm 패키지에 포함하지 않습니다.
- **상표**: "한글", "한컴", "HWP", "HWPX"는 주식회사 한글과컴퓨터의 등록 상표입니다. 이 프로젝트는 한글과컴퓨터와 제휴·후원·승인 관계가 없는 독립 오픈소스 프로젝트입니다.
- **책임 한계**: 이 도구의 결과는 검토용 후보입니다. 신청 자격이나 제출 의무를 확정하지 않으며, 결과를 근거로 한 판단의 책임은 사용자에게 있습니다.
