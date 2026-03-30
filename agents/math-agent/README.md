# Math QA Auditor Agent

A specialized mathematical QA agent powered by Claude API that audits the ProjectCare codebase for mathematical soundness, correctness, accuracy, and opportunities for improvement.

## What This Agent Does

🧮 **Mathematical Verification**: Checks that all formulas are correctly implemented and mathematically valid
🔗 **Integration Auditing**: Ensures mathematical components work together correctly
🛡️ **Numerical Stability**: Identifies division-by-zero, log(0), overflow/underflow risks
🚀 **Improvement Suggestions**: Proposes mathematical advances and algorithmic improvements
📚 **Academic Rigor**: References peer-reviewed literature and best practices

## Features

- Audits Beta distribution parameterization validity
- Verifies Gaussian copula is positive semi-definite
- Checks KL divergence calculations and threshold logic
- Validates moment preservation and CDF/PDF properties
- Scans for numerical stability issues
- Suggests alternatives (Clayton copula, Wasserstein distance, Bayesian optimization, etc.)
- Provides severity levels: CRITICAL, HIGH, MEDIUM, LOW

## Setup

### 1. Install Dependencies

```bash
cd agents/math-agent
pip install -r requirements.txt
```

### 2. Set API Key

You'll need an Anthropic API key. Get one at https://console.anthropic.com/

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

Or pass it directly:
```bash
python math-auditor.py core/baseline/beta-points.gs --api-key "sk-ant-..."
```

### 3. (Optional) Make Script Executable

```bash
chmod +x math-auditor.py
```

## Usage

### Basic Usage

Audit a single file:
```bash
python math-auditor.py core/baseline/beta-points.gs
```

Audit multiple files:
```bash
python math-auditor.py core/baseline/beta-points.gs core/reshaping/copula-utils.gs core/optimization/kl-divergence.gs
```

Audit from project root:
```bash
cd /path/to/system-google-sheets-addon
python agents/math-agent/math-auditor.py core/baseline/monte-carlo-smoothed.gs
```

### With Options

Specify agent directory:
```bash
python math-auditor.py core/reshaping/slider-adjustments.gs --agent-dir agents/math-agent
```

### VS Code Integration

#### Option A: Run from Terminal

Simply run the command above from VS Code's integrated terminal.

#### Option B: Create a Task

Add to `.vscode/tasks.json`:

```json
{
    "version": "2.0.0",
    "tasks": [
        {
            "label": "Math Audit - Current File",
            "type": "shell",
            "command": "python",
            "args": [
                "agents/math-agent/math-auditor.py",
                "${relativeFile}"
            ],
            "group": {
                "kind": "test",
                "isDefault": false
            },
            "presentation": {
                "reveal": "always",
                "panel": "new"
            },
            "problemMatcher": []
        },
        {
            "label": "Math Audit - All Core Files",
            "type": "shell",
            "command": "python",
            "args": [
                "agents/math-agent/math-auditor.py",
                "core/baseline/coordinator.gs",
                "core/reshaping/copula-utils.gs",
                "core/optimization/optimizer.gs",
                "core/helpers/metrics.gs"
            ],
            "group": {
                "kind": "test",
                "isDefault": false
            },
            "presentation": {
                "reveal": "always",
                "panel": "new"
            }
        }
    ]
}
```

Then run with: `Ctrl+Shift+B` (or `Cmd+Shift+B` on Mac) and select the task.

#### Option C: Keyboard Shortcut

Add to `.vscode/keybindings.json`:

```json
[
    {
        "key": "ctrl+alt+m",
        "command": "workbench.action.tasks.runTask",
        "args": "Math Audit - Current File"
    }
]
```

Then press `Ctrl+Alt+M` to audit the current file.

## Understanding The Output

The agent returns a detailed audit report in markdown. Key sections:

### Issues Found

Each issue includes:
- **Severity**: CRITICAL | HIGH | MEDIUM | LOW
- **Component**: Which part of the code is affected
- **Problem**: What's wrong (with mathematical detail)
- **Impact**: How it affects the system
- **Fix**: Specific suggestion to resolve it

### Example Output

```
## 🔴 CRITICAL: KL Divergence Asymmetry Not Handled

**Component**: core/optimization/kl-divergence.gs
**Problem**: The code computes KL(Q || P) but reversion logic uses symmetric comparison
**Impact**: Optimization may revert when it shouldn't (or vice versa)
**Fix**: Clearly document which direction KL is measured, ensure thresholds match actual computation

---

## 🟡 HIGH: Beta Parameter Validation Missing

**Component**: core/baseline/beta-points.gs
**Problem**: No check that α > 0 and β > 0 before using parameters
**Impact**: Could produce NaN or negative probabilities
**Fix**: Add validation: `if (alpha <= 0 || beta <= 0) throw new Error("Invalid Beta parameters")`
```

## Configuration Files

### `RULES.md`
Specifies 10 core mathematical constraints that the auditor checks:
1. Beta Distribution validity
2. Gaussian Copula properties
3. KL Divergence correctness
4. Moment preservation
5. CDF/PDF validity
6. PERT formula implementation
7. KDE smoothing stability
8. Trapezoid integration accuracy
9. Latin Hypercube sampling
10. Optimization reversion logic

**Edit this** to add new rules specific to your domain.

### `IMPROVEMENTS.md`
Tracks mathematical advances and alternatives:
- Beta vs. Johnson's SU / Burr / Generalized Gamma
- Gaussian vs. Clayton / Gumbel / Archimedean Copulas
- Latin Hypercube vs. Bayesian Optimization / Genetic Algorithms
- KL Divergence vs. Wasserstein / Jensen-Shannon / Hellinger
- And more...

**Edit this** to add new improvements to watch for.

### `config.json`
Configures:
- Numerical thresholds (KL max = 0.08, tolerance levels)
- Which components to focus on
- Output format preferences
- Improvement check categories

**Edit this** to tune audit parameters.

## Maintaining The Agent

### When Code Changes
```bash
# After modifying a file, audit it
python math-auditor.py core/baseline/beta-points.gs
```

### When Adding New Systems
```bash
# Add to RULES.md with new constraints
# Add to config.json in components_to_audit
# Re-run audit
```

### When Discovering Issues
```bash
# Document in RULES.md as "Known Limitation"
# Add to IMPROVEMENTS.md if it suggests a fix
# Create GitHub issue referencing the audit report
```

## Example Workflows

### Pre-Commit Audit
```bash
# Before committing, audit changed files
python math-auditor.py core/reshaping/slider-adjustments.gs
git add .
git commit -m "..."
```

### Release Verification
```bash
# Full audit before release
python math-auditor.py \
  core/baseline/coordinator.gs \
  core/reshaping/copula-utils.gs \
  core/optimization/optimizer.gs \
  core/helpers/metrics.gs
```

### Investigating A Bug
```bash
# If probability calculations seem off, audit:
python math-auditor.py core/reshaping/slider-adjustments.gs core/optimization/kl-divergence.gs
```

## Limitations

- Agent audits code correctness, not performance
- Requires RULES.md to be kept current
- Suggests improvements but doesn't guarantee they're better
- Not a substitute for peer review by human mathematicians
- Numerical thresholds in config.json may need adjustment for your specific use case

## References

Key mathematical concepts audited:
- **PERT/Beta**: Decision Analysis textbooks, PMBOK
- **Gaussian Copula**: Joe (2014), "Dependence Modeling with Copulas"
- **KL Divergence**: Cover & Thomas, "Information Theory"
- **KDE**: Wand & Jones (1995), "Kernel Smoothing"
- **Latin Hypercube**: McKay et al. (1979), "A Comparison of Three Methods..."

## Support

Having issues? Check:
1. Is `ANTHROPIC_API_KEY` set?
2. Does the file path exist?
3. Is `RULES.md` present in the agent directory?
4. Can you run: `python -c "import anthropic; print('OK')"`?

## Last Updated
February 15, 2026
