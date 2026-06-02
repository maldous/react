.PHONY: evidence

## evidence — Aggregate all stage evidence files into docs/evidence/stages/summary.json
evidence:
	$(call STEP,evidence: aggregating stage results)
	@node -e " \
	  const fs = require('fs'); \
	  const dir = 'docs/evidence/stages'; \
	  const stages = ['dev','test','staging','prod']; \
	  const results = {}; \
	  for (const s of stages) { \
	    const p = dir + '/' + s + '-latest.json'; \
	    if (fs.existsSync(p)) results[s] = JSON.parse(fs.readFileSync(p,'utf8')); \
	    else results[s] = { result: 'missing', note: 'stage not yet run' }; \
	  } \
	  const summary = { generatedAt: new Date().toISOString(), stages: results }; \
	  fs.mkdirSync(dir, { recursive: true }); \
	  fs.writeFileSync(dir + '/summary.json', JSON.stringify(summary, null, 2) + '\n'); \
	  console.log('Evidence summary:'); \
	  for (const [s,r] of Object.entries(results)) \
	    console.log('  ' + s + ': ' + (r.result || 'unknown')); \
	"
	$(call OK,evidence summary written to docs/evidence/stages/summary.json)
