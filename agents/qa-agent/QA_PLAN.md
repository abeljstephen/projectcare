# QA Plan — ProjectCare
<!-- ─────────────────────────────────────────────────────────────────────────
     This file is the canonical QA task list read by qa-agent.py at runtime.
     Add new tasks anywhere in the appropriate phase.  The agent will include
     every enabled task in its run and report results against each task ID.

     HOW TO ADD A TASK
     ─────────────────
     1. Pick the right phase.
     2. Choose the next available ID in that phase's block.
     3. Fill in all fields.  Leave "sub_agent" blank for static-only checks.
     4. Set enabled: true.  Set enabled: false to skip without deleting.

     TASK FIELDS
     ───────────
     id          Unique identifier, e.g. QA-001
     title       One-line description
     phase       static | math | research | design | ux | gas | dependency
     sub_agent   math-agent | research-agent | (blank = built-in static check)
     severity    CRITICAL | HIGH | MEDIUM | LOW  (if the check fails)
     enabled     true | false
     description What exactly is checked and what constitutes a pass/fail
     pass_when   Concrete pass criterion
     files       Which files are in scope (blank = all files in target)
───────────────────────────────────────────────────────────────────────────── -->

---

## Phase 1 — Static Code Analysis
> Automated checks with no API calls. Fast, always runs first.

### QA-001
- **title**: No duplicate HTML element IDs
- **phase**: static
- **severity**: FAIL
- **enabled**: true
- **description**: Every `id="..."` attribute in Plot.html must be unique. Duplicate IDs cause
  `getElementById()` to silently return only the first match — event bindings on duplicates are
  silently ignored and can produce hard-to-diagnose bugs.
- **pass_when**: Zero duplicate id= values in Plot.html
- **files**: Plot.html

### QA-002
- **title**: google.script.run chains have both success and failure handlers
- **phase**: static
- **severity**: WARN
- **enabled**: true
- **description**: Every `google.script.run` call in Plot.html must chain both
  `.withSuccessHandler()` and `.withFailureHandler()`. Missing failure handlers cause server-side
  errors to fail silently with no user feedback.
- **pass_when**: Every google.script.run call has both handlers
- **files**: Plot.html

### QA-003
- **title**: Slider key consistency across sliderIdMap / sliderValues() / STP2_STANCE_META
- **phase**: static
- **severity**: WARN
- **enabled**: true
- **description**: The three slider registries in Plot.html must reference exactly the same 7 keys.
  A key present in one but missing from another will cause that slider to be ignored or produce
  undefined values in the pipeline.
- **pass_when**: All 7 keys present identically in all three registries
- **files**: Plot.html

### QA-004
- **title**: Variant cache key includes all result-affecting inputs
- **phase**: static
- **severity**: FAIL
- **enabled**: true
- **description**: The `requestVariant()` cache key must include every input that changes the
  result. For `manual` variant: slider values must be in the key. For `adaptive`: probeLevel and
  RCF prior must be in the key. A missing input causes stale cached results to be returned when
  that input changes (the slider-not-updating bug).
- **pass_when**: Cache key for manual includes sliderValues(); adaptive includes probeLevel and rcf
- **files**: Plot.html

### QA-005
- **title**: No console.log() in GAS (.gs) files
- **phase**: static
- **severity**: WARN
- **enabled**: true
- **description**: `console.log()` is a no-op in Google Apps Script runtime. All logging must use
  `Logger.log()`. console.log in .gs files silently produces no output and misleads developers.
- **pass_when**: Zero console.log() calls in any .gs file
- **files**: *.gs

### QA-006
- **title**: Public GAS entry functions have top-level try/catch
- **phase**: static
- **severity**: WARN
- **enabled**: true
- **description**: Public functions callable from the Sheet menu or sidebar
  (pmcEstimatorAPI, pertRunAllRows, pertRunSelectedRows, pertRunCheckedRows,
  pertRerunLastSheet, pmcWriteReportTab) must have a top-level try/catch so uncaught exceptions
  surface as user-readable error messages rather than opaque GAS error dialogs.
- **pass_when**: Every listed public function has try/catch within first 30 lines of body
- **files**: Code.gs, core/report/sheet-writer.gs, core/main/main.gs

### QA-007
- **title**: HTML event attributes reference defined functions
- **phase**: static
- **severity**: WARN
- **enabled**: true
- **description**: Every function name used in onclick=, onchange=, oninput= HTML attributes must
  be defined somewhere in Plot.html (as a named function or window.xxx assignment). An undefined
  reference silently does nothing on click.
- **pass_when**: Zero onclick/onchange attribute references to undefined function names
- **files**: Plot.html

### QA-008
- **title**: All declared manifest files exist on disk
- **phase**: static
- **severity**: FAIL
- **enabled**: true
- **description**: Every .gs and .html file listed in the qa-agent target manifest must exist
  on disk. A missing file means a component is absent from the deployed add-on.
- **pass_when**: All manifest files found on disk
- **files**: (all target files)

### QA-009
- **title**: No eval() or innerHTML with unsanitised input
- **phase**: static
- **severity**: HIGH
- **enabled**: true
- **description**: Scan Plot.html and all .gs files for eval() calls and innerHTML assignments
  where the right-hand side is not a string literal. These are potential XSS or code injection
  vectors. innerHTML with a template literal containing user-controlled data is high risk.
- **pass_when**: Zero eval() calls; all innerHTML assignments use only controlled/sanitised values
- **files**: Plot.html, *.gs

### QA-010
- **title**: PropertiesService used correctly (script vs document scope)
- **phase**: static
- **severity**: MEDIUM
- **enabled**: true
- **description**: `getScriptProperties()` is shared across all users of the script.
  `getDocumentProperties()` is per-spreadsheet. `getUserProperties()` is per-user.
  Verify that pmc_last_src_sheet and other keys are stored in the correct scope for their
  intended lifetime and sharing behaviour.
- **pass_when**: Each PropertiesService call uses the appropriate scope for its data
- **files**: Code.gs

---

## Phase 2 — Mathematical Verification
> Delegated to math-agent. Checks PERT, Beta, KDE, copula, KL, CDF correctness.

### QA-020
- **title**: PERT formula correctness (lambda=4 weighting)
- **phase**: math
- **sub_agent**: math-agent
- **severity**: CRITICAL
- **enabled**: true
- **description**: PERT mean must equal (O + 4M + P) / 6. Beta shape parameter must produce
  alpha > 0 and beta > 0. Verify the lambda=4 weighting is applied exactly and not overridden
  or approximated anywhere in the codebase.
- **pass_when**: PERT mean formula is exact; alpha and beta are both positive for all valid inputs
- **files**: core/baseline/pert-points.gs

### QA-021
- **title**: Beta distribution parameterisation validity
- **phase**: math
- **sub_agent**: math-agent
- **severity**: CRITICAL
- **enabled**: true
- **description**: Beta(α, β) parameters must both be > 0. The mapping from PERT moments to Beta
  parameters must be monotone and numerically stable across the full input range (O<M<P,
  including near-degenerate cases where M is close to O or P).
- **pass_when**: No parameter values ≤ 0 for any valid (O, M, P) triple; degenerate inputs handled
- **files**: core/baseline/pert-points.gs

### QA-022
- **title**: KDE bandwidth scales with distribution range
- **phase**: math
- **sub_agent**: math-agent
- **severity**: HIGH
- **enabled**: true
- **description**: KDE bandwidth h must be proportional to the range (P - O). A fixed constant
  bandwidth would under-smooth wide distributions and over-smooth narrow ones. Verify the
  bandwidth formula and that h > 0 for all inputs.
- **pass_when**: Bandwidth is a function of range and sample size; h > 0 always
- **files**: core/baseline/monte-carlo-smoothed.gs

### QA-023
- **title**: Gaussian copula matrix is positive semi-definite
- **phase**: math
- **sub_agent**: math-agent
- **severity**: HIGH
- **enabled**: true
- **description**: The 7×7 BASE_R correlation matrix in copula-utils.gs must be positive
  semi-definite (all eigenvalues ≥ 0) for the Cholesky decomposition used in copula sampling
  to be valid. A non-PSD matrix produces imaginary Cholesky factors and undefined results.
- **pass_when**: All eigenvalues of BASE_R ≥ 0; Cholesky decomposition succeeds
- **files**: core/reshaping/copula-utils.gs

### QA-024
- **title**: KL divergence guards against log(0)
- **phase**: math
- **sub_agent**: math-agent
- **severity**: HIGH
- **enabled**: true
- **description**: KL divergence = Σ p(x) · log(p(x)/q(x)). When q(x) = 0 or p(x) = 0, the
  expression is undefined. The implementation must epsilon-clamp both distributions before
  computing log ratios.
- **pass_when**: No unguarded log(0) or division by zero in KL computation
- **files**: core/optimization/kl-divergence.gs

### QA-025
- **title**: CDF arrays are strictly monotone non-decreasing and clamped to [0,1]
- **phase**: math
- **sub_agent**: math-agent
- **severity**: HIGH
- **enabled**: true
- **description**: Any CDF passed to interpolateCdf() or invertCdf() must be sorted ascending,
  have no duplicate x-values, start at or above 0, end at exactly 1.0, and have no
  negative jumps. Verify ensureSortedMonotoneCdf() enforces all these invariants.
- **pass_when**: ensureSortedMonotoneCdf() sorts, deduplicates, clamps, enforces monotone, snaps tail
- **files**: core/helpers/metrics.gs

### QA-026
- **title**: Slider blend weights sum to ≤ 1
- **phase**: math
- **sub_agent**: math-agent
- **severity**: HIGH
- **enabled**: true
- **description**: In computeAdjustedMoments(), the blend weights λ_i for each slider must sum
  to ≤ 1 across all active sliders to prevent the adjusted mean from exceeding the distribution
  bounds. Over-weighting pushes the result outside [O, P].
- **pass_when**: Σ λ_i ≤ 1 for all valid slider configurations
- **files**: core/reshaping/copula-utils.gs

### QA-027
- **title**: Moment preservation after Beta refit
- **phase**: math
- **sub_agent**: math-agent
- **severity**: MEDIUM
- **enabled**: true
- **description**: After betaRefit() adjusts α and β to match the target mean shift (m0) and
  variance shrink (m1), the resulting Beta distribution's actual mean and variance must be
  within an acceptable tolerance of the target moments. Large deviations indicate the refit
  is not converging.
- **pass_when**: |fitted_mean - target_mean| < 0.01 · range; |fitted_var - target_var| < 0.05 · range²
- **files**: core/reshaping/slider-adjustments.gs

### QA-028
- **title**: Numerical stability at boundary inputs (O=M, M=P, O=M=P)
- **phase**: math
- **sub_agent**: math-agent
- **severity**: HIGH
- **enabled**: true
- **description**: Degenerate inputs (zero variance: O=M, M=P, or O=M=P) must not produce
  NaN, Infinity, or division-by-zero anywhere in the pipeline. The codebase must handle these
  edge cases explicitly.
- **pass_when**: Pipeline returns a valid (possibly trivial) result for all degenerate inputs
- **files**: core/baseline/pert-points.gs, core/reshaping/slider-adjustments.gs, core/helpers/metrics.gs

---

## Phase 3 — Flow & Dependency Analysis
> Delegated to research-agent. Traces data flow, call chains, and cross-file dependencies.

### QA-030
- **title**: Pipeline integrity — every stage boundary is type-safe
- **phase**: research
- **sub_agent**: research-agent
- **severity**: CRITICAL
- **enabled**: true
- **description**: Trace the complete data flow from pmcEstimatorAPI() through generateBaseline(),
  reshapeDistribution(), optimizeSliders(), and adaptResponse(). At each stage boundary,
  identify what data is passed in, what comes out, and whether any required field could be
  undefined, missing, or incorrectly typed. Flag missing null guards.
- **pass_when**: All stage boundaries have validated inputs; no required field can arrive as undefined
- **files**: core/main/main.gs, core/baseline/coordinator.gs, core/reshaping/slider-adjustments.gs,
            core/optimization/optimizer.gs, core/variable_map/adapter.gs

### QA-031
- **title**: Slider data flow from Card D inputs to API call
- **phase**: research
- **sub_agent**: research-agent
- **severity**: HIGH
- **enabled**: true
- **description**: Trace how slider values flow: Card D stp2d_* inputs → hidden s_* inputs →
  sliderValues() → requestVariant() → API params. Verify (1) the card D input event propagates
  values correctly to hidden inputs, (2) setSlidersDisabled() never blocks this propagation
  when manualOn=true, (3) sliderValues() always reads the current card D values.
- **pass_when**: Slider value at card D is identical to slider value sent in API params
- **files**: Plot.html

### QA-032
- **title**: Cross-file function dependency map — no missing definitions
- **phase**: research
- **sub_agent**: research-agent
- **severity**: HIGH
- **enabled**: true
- **description**: Map every function called in one file that is defined in a different file.
  For each cross-file call, confirm the target function exists in the expected file.
  Flag any call where the definition cannot be found in the codebase.
- **pass_when**: Every cross-file function call resolves to a definition in the scanned files
- **files**: core/main/main.gs, core/baseline/coordinator.gs, core/reshaping/copula-utils.gs,
            core/reshaping/slider-adjustments.gs, core/optimization/optimizer.gs,
            core/helpers/metrics.gs, core/variable_map/adapter.gs

### QA-033
- **title**: Variant cache key completeness — all result-affecting inputs included
- **phase**: research
- **sub_agent**: research-agent
- **severity**: CRITICAL
- **enabled**: true
- **description**: For each variant (manual, fixed, adaptive), list every input that affects
  the computed result. Verify each is in the cache key. A missing input causes stale results.
  Special focus: manual variant must include slider values; adaptive must include probeLevel.
- **pass_when**: No result-affecting input is absent from the cache key for its variant
- **files**: Plot.html

### QA-034
- **title**: RCF prior propagation — prior reaches every variant that uses it
- **phase**: research
- **sub_agent**: research-agent
- **severity**: HIGH
- **enabled**: true
- **description**: Trace how the RCF (Reference Class Forecasting) prior from getHistPrior()
  flows into the pipeline. Verify it is included in the saveAndRun() payload, in the
  requestVariant() params for all variants, and in the variant cache key. Verify that
  pmcRefreshBaseline() correctly invalidates the cache when the RCF prior changes.
- **pass_when**: RCF prior reaches all three variant API calls and is in all three cache keys
- **files**: Plot.html

### QA-035
- **title**: Group/aggregate mode guard — no single-task paths execute in group mode
- **phase**: research
- **sub_agent**: research-agent
- **severity**: HIGH
- **enabled**: true
- **description**: When TM.mode === 'aggregate', the fetchData() single-task path must be
  blocked. Verify every code path that calls fetchData() or requestVariant() correctly checks
  the mode and redirects to TM.saveAndRun() where needed.
- **pass_when**: fetchData() and requestVariant() are never called in aggregate mode
- **files**: Plot.html

---

## Phase 4 — UX & Design Consistency
> Checked by synthesis agent against design conventions.

### QA-040
- **title**: All card condition sections have a management-context label
- **phase**: design
- **severity**: LOW
- **enabled**: true
- **description**: Cards B, C, and D must each have a stp2-conditions-intro label that names
  the conditions as "management conditions" and includes a ? tooltip explaining what the 7
  levers are. Without this, users don't know what the sliders represent.
- **pass_when**: All three cards have intro label with "management conditions" text and tooltip
- **files**: Plot.html

### QA-041
- **title**: Probability display is consistent across all four cards
- **phase**: design
- **severity**: MEDIUM
- **enabled**: true
- **description**: Cards A (baseline), B (adaptive), C (fixed), D (manual) must all display
  probability in the same format and location. The delta track (lift bar) must be present on
  B, C, D. Pending/loading states must be visually consistent.
- **pass_when**: All four cards display probability and delta track consistently
- **files**: Plot.html

### QA-042
- **title**: Export buttons disabled until a run has completed
- **phase**: design
- **severity**: MEDIUM
- **enabled**: true
- **description**: The "New Tab: Snapshot" and "New Tab: Full Report" export buttons should be
  disabled (or hidden) when no completed run data is available in window.S. Exporting an empty
  state should produce an informative error, not a blank sheet.
- **pass_when**: Export buttons are disabled/hidden until window.S contains valid run data
- **files**: Plot.html

---

## Phase 5 — GAS Platform Compliance
> Google Apps Script-specific checks.

### QA-050
- **title**: No Utilities.sleep() in sheet-writing loops
- **phase**: gas
- **severity**: MEDIUM
- **enabled**: true
- **description**: sheet-writer.gs must not use Utilities.sleep() inside loops that process
  rows. GAS execution limit is 6 minutes; sleep calls waste quota. Row operations should
  be batched with setValues() rather than per-cell calls.
- **pass_when**: Zero Utilities.sleep() calls; all row writes use batch setValues()
- **files**: core/report/sheet-writer.gs

### QA-051
- **title**: SpreadsheetApp calls are batched, not per-cell
- **phase**: gas
- **severity**: MEDIUM
- **enabled**: true
- **description**: In sheet-writer.gs and Code.gs, every write to the spreadsheet must use
  setValues() on a range rather than individual setValue() calls in a loop. Per-cell calls
  are ~100× slower and frequently hit the GAS execution limit.
- **pass_when**: No setValue() (singular) inside a loop; all bulk writes use setValues()
- **files**: core/report/sheet-writer.gs, Code.gs

### QA-052
- **title**: clasp deployment slot budget within limits
- **phase**: gas
- **severity**: INFO
- **enabled**: true
- **description**: Check deploy-tracker.md to verify deployment slots (max 20) and version
  slots (max 100) are within safe bounds. Warn if either exceeds 80% capacity.
- **pass_when**: Deployments ≤ 16/20, Versions ≤ 80/100
- **files**: agents/limits-monitor/deploy-tracker.md

---

## Phase 6 — Dependency & Integration Checks
> Verifies that all inter-module contracts are honoured.

### QA-060
- **title**: adaptResponse() output schema matches UI expectations
- **phase**: dependency
- **sub_agent**: research-agent
- **severity**: HIGH
- **enabled**: true
- **description**: Trace what adaptResponse() returns and compare it against what Plot.html's
  applyVariantResult() expects to receive. Any field that Plot.html reads but adaptResponse()
  doesn't guarantee will produce silent undefined in the UI.
- **pass_when**: Every field read by applyVariantResult() is guaranteed in adaptResponse() output
- **files**: core/variable_map/adapter.gs, Plot.html

### QA-061
- **title**: WordPress engine output matches GAS engine output for same inputs
- **phase**: dependency
- **sub_agent**: research-agent
- **severity**: HIGH
- **enabled**: true
- **description**: For the same (O, M, P, target, sliders) input, the WordPress browser engine
  (saco.js) and the GAS engine (main.gs) must produce probabilities within ±0.5pp of each other.
  Divergence indicates the port has drifted from the reference implementation.
- **pass_when**: |GAS_prob - WP_prob| < 0.005 for a standard test vector
- **files**: core/main/main.gs, wordpress-plugin/pmc-estimator/assets/js/engine/saco.js

---

## Phase 7 — WordPress CRM PHP Static Checks
> Static analysis of the projectcare-crm WordPress plugin. No API calls. Runs when target = wordpress-crm.

### QA-070
- **title**: All PHP files begin with ABSPATH guard
- **phase**: static
- **severity**: FAIL
- **enabled**: true
- **description**: Every PHP file included by the plugin must have `defined('ABSPATH') || exit;` as
  the first executable line. Without this guard, the file can be accessed directly via HTTP and
  exposes internal logic, credentials, and database queries.
- **pass_when**: Zero PHP files lack the ABSPATH guard
- **files**: includes/*.php, includes/admin/*.php, includes/email/*.php

### QA-071
- **title**: All HTML output is escaped (esc_html / esc_attr / esc_url)
- **phase**: static
- **severity**: HIGH
- **enabled**: true
- **description**: Every `echo` statement that outputs user-supplied, database-sourced, or
  plugin-computed data must be wrapped in `esc_html()`, `esc_attr()`, or `esc_url()` as
  appropriate. Raw echo of unescaped data is a stored XSS vector.
- **pass_when**: Zero unescaped echo statements on non-literal values in admin/*.php and rest-api.php
- **files**: includes/admin/*.php, includes/rest-api.php

### QA-072
- **title**: All $wpdb queries use prepare() for external input
- **phase**: static
- **severity**: CRITICAL
- **enabled**: true
- **description**: Any `$wpdb->query()`, `$wpdb->get_var()`, `$wpdb->get_results()` call that
  incorporates a variable must use `$wpdb->prepare()` with `%s`/`%d`/`%f` placeholders.
  String interpolation in SQL is a SQL injection vector.
- **pass_when**: Zero direct string-interpolated variables in wpdb query calls
- **files**: includes/*.php, includes/admin/*.php

### QA-073
- **title**: All POST handlers verify a nonce before processing
- **phase**: static
- **severity**: HIGH
- **enabled**: true
- **description**: Every handler that reads `$_POST` data must call `wp_verify_nonce()` (or
  `check_admin_referer()`) before taking any action. A missing nonce check allows CSRF attacks
  that can modify user data, grant credits, or regenerate keys.
- **pass_when**: Every $_POST handler has a wp_verify_nonce() or check_admin_referer() call
- **files**: includes/admin/*.php

### QA-074
- **title**: $wpdb return values checked for failure
- **phase**: static
- **severity**: MEDIUM
- **enabled**: true
- **description**: `$wpdb->insert()`, `$wpdb->update()`, and `$wpdb->delete()` return `false`
  on error and an integer (possibly 0) on success. Code must not assume success; critical
  writes (key issuance, credit deduction, payment logging) must check the return value.
- **pass_when**: All wpdb->insert/update/delete calls on critical paths check the return value
- **files**: includes/stripe.php, includes/rest-api.php, includes/admin/user-detail.php

### QA-075
- **title**: PC_CRM_VERSION bumped when schema changes
- **phase**: static
- **severity**: FAIL
- **enabled**: true
- **description**: Detect whether schema.php contains table definitions that would not have
  existed in `PC_CRM_VERSION == '2.0.0'` (specifically `wp_pc_payments`). If the version
  is still `2.0.0`, `pc_maybe_upgrade()` will never fire on existing installs and the new
  table will not be created. The version must be at least `2.1.0` when `wp_pc_payments` is
  present in schema.php.
- **pass_when**: PC_CRM_VERSION >= 2.1.0 when wp_pc_payments is in schema.php
- **files**: projectcare-crm.php, includes/schema.php

### QA-076
- **title**: Cross-system contract — GAS deduct payload matches WP REST handler
- **phase**: research
- **sub_agent**: research-agent
- **severity**: HIGH
- **enabled**: true
- **description**: The GAS webapp.gs posts a JSON payload to the WordPress `/deduct` REST
  endpoint. Verify that every field GAS sends is consumed by the WP handler, and every
  required field the WP handler expects is sent by GAS. Silent contract drift means fields
  arrive as null without error, corrupting activity logs and credit accounting.
- **pass_when**: Every field in the GAS deduct payload maps to a consumed field in wp rest-api.php deduct handler; no required field is absent from either side
- **files**: system-google-sheets-addon/webapp.gs, wordpress-plugin/projectcare-crm/includes/rest-api.php

---

## Phase 8 — Custom GPT Contract Checks
> Static and research checks for the Custom GPT definition. Runs when target = custom-gpt.

### QA-080
- **title**: All slider key names match SLIDER_KEYS canonical set
- **phase**: static
- **severity**: HIGH
- **enabled**: true
- **description**: Every slider key name appearing in instructions.md or openapi.yaml must
  exactly match one of the 7 canonical keys: `budgetFlexibility`, `scheduleFlexibility`,
  `scopeCertainty`, `scopeReductionAllowance`, `reworkPercentage`, `riskTolerance`,
  `userConfidence`. Any deviation (typo, camelCase mismatch, underscore variant) causes that
  slider to be silently ignored by the copula.
- **pass_when**: Zero slider key names in GPT files that are not in the canonical set
- **files**: custom-gpt/instructions.md, custom-gpt/openapi.yaml

### QA-081
- **title**: All GPT-referenced actions exist in openapi.yaml
- **phase**: static
- **severity**: FAIL
- **enabled**: true
- **description**: Every action name that instructions.md directs the GPT to call must be
  defined as an operationId or path in openapi.yaml. An action mentioned in instructions but
  absent from the schema will silently fail — the GPT will attempt the call and receive an
  error with no useful feedback to the user.
- **pass_when**: Zero action names in instructions.md that are not defined in openapi.yaml
- **files**: custom-gpt/instructions.md, custom-gpt/openapi.yaml

### QA-082
- **title**: reworkPercentage domain is 0–50, not 0–100
- **phase**: static
- **severity**: HIGH
- **enabled**: true
- **description**: The `reworkPercentage` slider has a UI domain of 0–50 (not 0–100). The
  `to01FromUi()` function divides by 50 for this slider. If instructions.md or openapi.yaml
  document its range as 0–100, users will supply values up to 100 and the copula will receive
  inputs > 1 after normalization, producing undefined results.
- **pass_when**: reworkPercentage is documented as 0–50 (or equivalent) in all GPT files
- **files**: custom-gpt/instructions.md, custom-gpt/openapi.yaml

### QA-083
- **title**: Credit costs in instructions.md match REST API deduct handler
- **phase**: research
- **sub_agent**: research-agent
- **severity**: HIGH
- **enabled**: true
- **description**: The credit cost for each operation type (`baseline_only`=1, `full_saco`=2,
  `saco_explain`=4) must be stated consistently in instructions.md and enforced by the
  WordPress REST API deduct endpoint. If they diverge, the GPT tells users incorrect costs
  or over/under-charges without surfacing an error.
- **pass_when**: Credit costs for all three operation types match between instructions.md and rest-api.php
- **files**: custom-gpt/instructions.md, wordpress-plugin/projectcare-crm/includes/rest-api.php

### QA-084
- **title**: All response fields read by GPT exist in adaptResponse() output
- **phase**: research
- **sub_agent**: research-agent
- **severity**: HIGH
- **enabled**: true
- **description**: For each field that instructions.md tells the GPT to extract from the API
  response (e.g. `probability`, `p10`, `p90`, `mean`, slider blocks), verify that
  `adaptResponse()` in adapter.gs guarantees that field in its output. A field the GPT reads
  but the API doesn't guarantee will arrive as undefined, producing silent wrong output.
- **pass_when**: Every response field referenced in instructions.md is present in adaptResponse() output schema
- **files**: custom-gpt/instructions.md, system-google-sheets-addon/core/variable_map/adapter.gs

### QA-085
- **title**: Promo code behaviour in instructions.md reflects REST API logic
- **phase**: research
- **sub_agent**: research-agent
- **severity**: MEDIUM
- **enabled**: true
- **description**: If instructions.md describes promo code behaviour (e.g. what happens when
  a code is applied, credit overrides, plan overrides), verify this matches the actual promo
  logic in rest-api.php `/trial` handler. Discrepancy means the GPT gives users incorrect
  information about what a promo code does.
- **pass_when**: Promo code effects described in instructions.md match the REST API /trial promo logic
- **files**: custom-gpt/instructions.md, wordpress-plugin/projectcare-crm/includes/rest-api.php

### QA-086
- **title**: openapi.yaml request/response schemas are internally consistent
- **phase**: static
- **severity**: MEDIUM
- **enabled**: true
- **description**: In openapi.yaml, verify that: (1) every request body field matches its
  described type (string, integer, number); (2) required fields are marked as required; (3)
  enum values for `operation_type` include exactly `baseline_only`, `full_saco`, `saco_explain`;
  (4) no field is defined with conflicting types across different operations.
- **pass_when**: openapi.yaml passes schema self-consistency checks; enum values match the three canonical operation types
- **files**: custom-gpt/openapi.yaml

---

## Adding New Tasks — Template

Copy this block and fill in all fields:

```
### QA-NNN
- **title**:
- **phase**: static | math | research | design | ux | gas | dependency
- **sub_agent**: math-agent | research-agent | (omit for static)
- **severity**: CRITICAL | HIGH | MEDIUM | LOW | INFO
- **enabled**: true
- **description**:
- **pass_when**:
- **files**:
```
