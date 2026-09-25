# korean-notice-mcp

[![npm](https://img.shields.io/npm/v/korean-notice-mcp.svg)](https://www.npmjs.com/package/korean-notice-mcp) [![test](https://github.com/RosieOh/korean-notice-mcp/actions/workflows/test.yml/badge.svg)](https://github.com/RosieOh/korean-notice-mcp/actions/workflows/test.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[한국어](https://github.com/RosieOh/korean-notice-mcp/blob/main/README.md) | English

**An MCP server that compares last year's and this year's Korean public notices and tells you, with source evidence, which eligibility rules and required documents changed.**

Korean local governments publish recruitment notices for grants and youth programs (공고) as HWP/HWPX files, the Hangul word-processor formats. Most AI apps can't read those formats well. This server lets an AI app such as Claude Desktop read the notices. Every result carries a source location and the document's SHA-256 hash, so a person can check each claim against the original.

![Demo: comparing the 2025 and 2026 youth club notices](https://raw.githubusercontent.com/RosieOh/korean-notice-mcp/main/docs/demo-compare.gif)

The recording above shows the real output for two public notices from Jangsu County: the 2025 youth club notice (HWP) and the 2026 one (HWPX). The top three changes it finds:

1. The business registration certificate went from required to conditional.
2. The application period moved.
3. The minimum applicant age rose from 15 to 18.

## Quick start

Requires Node.js 22+.

```bash
npx -y korean-notice-mcp compare 2025-notice.hwp 2026-notice.hwpx   # ranked changes + checklist
npx -y korean-notice-mcp checklist 2026-notice.hwpx                  # documents and period only
npx -y korean-notice-mcp --demo                                      # MCP tool output on synthetic samples
```

### Claude Desktop

`MCP_DATA_DIR` is the folder that holds your notice files. The server only reads files inside it.

```json
{
  "mcpServers": {
    "korean-notice": {
      "command": "npx",
      "args": ["-y", "korean-notice-mcp"],
      "env": { "MCP_DATA_DIR": "C:\\Users\\me\\Documents\\notices" }
    }
  }
}
```

## Tools

| Tool | What it does |
|---|---|
| `extract_requirements` | Submission documents (required or conditional, with the condition text), application period and eligibility candidates, each with a source location |
| `compare_notices` | Compares two notices. Lists document and period changes first, then text and table changes ranked by importance. Lines where only the year changed are listed separately in `date_only_changes` |
| `read_notice` | Body text and tables (rows, columns, merged cells) with locations and hash |
| `get_evidence` | Re-reads the original text at a location, provided the document hash still matches |

Supported formats are HWP, HWPX, TXT, MD and CSV. PDF and OCR are not supported yet. Every tool is read-only, and none of them makes network calls.

## Accuracy

We evaluated on 10 public notices: 5 programs × 2 years, all from one county. We tuned the rules on 3 pairs and held out 2 pairs. Method and full results are in [benchmarks/README.md](benchmarks/README.md) (in Korean).

| | Previous version | This version |
|---|---|---|
| Document recall / precision (all pairs) | 66% / 7% | 92% / 84% |
| Application period found | 0/10 | 10/10 |
| High-importance changes in the top 15 (of 34) | 4 | 24 |
| Change items a user has to review | 1,779 | 403 |

Limitations, stated plainly:

- **On the held-out pairs, the first blind run found only 43% of the documents.** One unfamiliar table layout made the extractor miss a whole document list. After fixing that one cause, recall reached 86%, but that number is no longer blind.
- **A second blind run on 3 pairs from other governments (Gunsan, Yongin, Daejeon)** kept document precision at 90%, but recall was only 47%. For the Gunsan notices the extractor found no documents and no application period at all: it did not recognize the heading styles "신청서류 (…)" and "신청접수 :". Handling unfamiliar layouts is the main weakness today.
- An AI drafted the gold labels by reading the originals. No human has reviewed them yet. The sample comes from a single county.
- The extractor is rule-based. It may treat reference tables (for example "how to obtain documents") as submission lists, and it misses documents mentioned outside the documents section.
- It does not decide legal meaning or eligibility. Always confirm with the original notice and the responsible office.

## How it works

- **HWP**: parsed with [rhwp](https://github.com/edwardkim/rhwp) (`@rhwp/core`, MIT). We rebuild table rows and columns through rhwp's table API, which lets the extractor tell document columns apart from issuer and remark columns.
- **HWPX**: parsed with a built-in XML parser.
- **Extraction**: follows Korean notice headings such as 제출서류, (접수기간) and □ 신청대상. It reads document names from numbered items, lists in parentheses and ※ notes, and treats phrases like 해당자 ("if applicable") and 택 1 ("choose one") as conditions.
- **Comparison**: diffs the two notices line by line. Lines where only the year changed are listed separately, and changed cells of one table are grouped into a single item. Items are then ranked by section (eligibility, documents, period, amount) and by changes in numbers and keywords.

## Related projects

- [kordoc](https://github.com/chrisryugj/kordoc): general Korean document parser (HWP, HWPX, PDF, DOCX) with an MCP server and document diff. It is the better choice for PDF notices.
- [rhwp](https://github.com/edwardkim/rhwp): the HWP engine this project uses. It has its own built-in MCP server.
- [treesoop/hwp-mcp](https://github.com/treesoop/hwp-mcp): general HWP read/write MCP server.

What this project adds on top of those:

- Extraction specific to notices: which documents are required or conditional, and the application period.
- A year-over-year change ranking.
- A public evaluation set built from real notices.

## Contributing

The most useful contributions are notice pairs from other governments and gold labels for them, especially labels a human has reviewed. Please don't attach real application documents that contain personal data (see [SECURITY.md](SECURITY.md)).

## License and notices

- **Code**: MIT. HWP parsing by [@rhwp/core](https://www.npmjs.com/package/@rhwp/core) (MIT, Edward Kim).
- **Quoted notice text is not MIT-licensed.** The gold labels and results in `benchmarks/`, and the demo image, quote short excerpts from public notices published by Jangsu County, for research and evaluation. Rights to those excerpts stay with the original author. The source posts carry [KOGL Type 4](https://www.kogl.or.kr/info/license.do): attribution required, no commercial use, no modification. Sources are listed in [benchmarks/sources.json](benchmarks/sources.json). The original notice files are not included in this repository or the npm package.
- **Trademarks**: "한글" (Hangul), "한컴" (Hancom), "HWP" and "HWPX" are registered trademarks of Hancom Inc. This is an independent open-source project with no affiliation with, sponsorship by, or endorsement from Hancom Inc.
- **No warranty on results**: Outputs are candidates for human review. They do not determine eligibility or submission obligations, and users are responsible for any decision based on them.
