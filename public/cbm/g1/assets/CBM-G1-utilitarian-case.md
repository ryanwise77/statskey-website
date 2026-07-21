# CBM G1 — Utilitarian Case

Checked against live sources on 2026-07-19.

## Bottom line

The strongest reason to build CBM is not to give healthy people more
biomarkers. It is to create shared, open measurement infrastructure and then
validate narrow programs in which:

1. chemistry changes during a clinically important blind interval;
2. current testing is sparse, burdensome, delayed, or inaccessible;
3. a trustworthy trend triggers a defined confirmation step;
4. confirmation changes treatment or monitoring;
5. the changed decision improves survival, function, safety, autonomy, or
   burden.

No patient should rely on the present research device. Its patient utility is
conditional on validation. Its current utility is as a research platform.

## Who needs it

| Priority | Population / institution | Need | Present evidence | Honest role |
| --- | --- | --- | --- | --- |
| Build now | Translational biosensor laboratories and clinical investigators | Reader development is repeatedly duplicated before chemistry can be tested | Biocoin publishes a multimodal open reader; CBM adds a cartridge and quality framework | Shared research infrastructure, raw-data standard, reproducible validation |
| Validate first | Diabetes programs managing DKA risk | Ketone can rise independently of glucose; continuous glucose+ketone is now commercially authorized in Europe | Libre Duo has CE Mark; human ketone studies exist, but 2026 data also show multi-day drift | Comparator-gated glucose/BHB research; do not duplicate an incumbent without added utility |
| Validate first | CKD, heart failure, and RAASi/MRA medication programs | Potassium monitoring gaps can delay safe titration; stopping beneficial therapy after hyperkalemia is associated with adverse outcomes | 46.5% lacked a 7-day potassium check in one HFrEF cohort; ISF potassium clinical accuracy remains unproven | Trend research that triggers potassium/creatinine confirmation, never autonomous dosing |
| Conditional | Dialysis and acute-care electrolyte surveillance | Rapid shifts occur between episodic samples | Clinical need is established; continuous dermal potassium is not | Short, supervised studies paired with blood gas or laboratory measurements |
| Conditional | Sepsis / critical-care lactate workflows | Serial draws leave blind intervals and contribute to diagnostic blood loss | Human microneedle lactate precedent exists; outcome benefit from continuous dermal lactate is not established | Bedside research node; confirmation and protocol integration required |
| Conditional | Therapeutic drug monitoring | Sparse drug levels can miss pharmacokinetic variation and require repeated blood draws | A 2026 six-person vancomycin pilot achieved 5-minute resolution; degradation limited primary analysis to 12 h | High-value expansion cartridge after platform validation |
| Do not target now | Healthy general population | Most variations have no predefined clinical action | No evidence that broad continuous panels improve outcomes | Avoid consumer medicalization, false alarms, surveillance, and waste |

## Human flourishing

### Survival and bodily security

Potentially high, but only in selected high-risk cohorts. Earlier confirmation
could identify dangerous trajectories or preserve beneficial therapies. A
biomarker association is not an outcome benefit; prospective studies must
show that the monitoring workflow changes care safely.

### Autonomy and daily capability

Potentially moderate. A validated system could reduce travel, waiting, and
venipuncture while helping patients and caregivers navigate medication
changes. Autonomy falls—not rises—if false alerts, uninterpretable variation,
or opaque risk scores dominate daily life.

### Scientific and professional capability

Highest near-term utility. Open hardware, shared cartridge interfaces, raw
traces, and common quality gates can let more laboratories test sensing
chemistry and reproduce results. This is a public-good argument even before a
clinical indication succeeds.

### Justice and access

Conditional. Approximately 47% of the world lacks access to essential
diagnostic testing. A portable reusable reader could support distributed
research or clinic nodes, but it is not a substitute for basic diagnostic
capacity. WHO guidance emphasizes financed, tiered networks, trained staff,
quality assurance, supply chains, referral laboratories, and maintenance.

The equitable distributed form is therefore likely:

- reusable readers placed in clinics, hospitals, and regional research
  programs;
- locally relevant, separately validated cartridges;
- common calibration and raw-data standards;
- referral and confirmation pathways;
- transparent pricing and repair;
- not unsupported direct-to-consumer distribution.

### Environmental flourishing

Mixed. Reusing the reader is better than putting a battery and radio into every
cartridge, but the sterile adhesive, applicator, packaging, and sharp remain
disposable. A 2024 estimate for worldwide CGM use found about 20,000 tonnes of
annual packaging/applicator/leaflet waste and 580 tonnes of direct sensor
waste. CBM should minimize cartridge mass, avoid disposable electronics,
publish material composition, and plan take-back before scale.

## Required utility chain

```text
valid signal
  → earlier confirmatory test or review
    → changed clinical decision
      → better patient-important outcome
```

If any link fails, more measurement does not create utility.

## Major harms and opportunity costs

- **False reassurance:** an invalid trend can delay needed care.
- **False alarm and overtreatment:** noisy trajectories can prompt unnecessary
  tests, medication changes, emergency visits, and anxiety.
- **Medicalization:** continuous normal variation can be mislabeled as risk.
- **Privacy and surveillance:** molecular data can expose disease, behavior,
  treatment, or pregnancy-related information.
- **Unequal access:** early systems may benefit wealthy programs while drawing
  capital from basic diagnostics.
- **Clinical attention:** more streams can worsen alarm burden and clinician
  workload.
- **Disposable waste:** sterile sharps, plastics, adhesives, and packaging
  accumulate quickly.
- **Opportunity cost:** money spent on an unproven wearable may save more lives
  if used for essential tests, staffing, medication access, or reliable
  follow-up.

## Decision rule

Build or expand a cartridge only when all are true:

1. the target population has a material, time-sensitive burden;
2. the analyte is measurable in the chosen biofluid;
3. the trend has a predefined action and confirmation pathway;
4. the quality system detects likely failure;
5. a comparative study can measure patient-important benefit;
6. the program is more cost-effective than improving existing testing;
7. privacy, workload, access, and waste are explicitly budgeted.

## Kill criteria

Stop or narrow a program if:

- paired data cannot support the claimed trend;
- alerts do not advance a useful confirmation;
- clinicians cannot act without adding net harm or workload;
- incumbent devices already solve the same problem more safely;
- the distributed workflow lacks quality assurance or referral capacity;
- environmental and financial costs exceed plausible benefit;
- outcome studies do not improve patient-important endpoints.

## Sources

- WHO essential diagnostics and tiered diagnostic systems:
  https://doi.org/10.1016/S2214-109X(23)00568-5
- Biocoin open research platform:
  https://doi.org/10.1038/s44328-026-00103-z
- 2026 continuous microneedle translation review:
  https://pubmed.ncbi.nlm.nih.gov/41529615/
- Libre Duo glucose+ketone CE Mark:
  https://abbott.mediaroom.com/2026-05-27-Abbott-secures-CE-Mark-for-worlds-first-dual-glucose-ketone-sensing-technology-for-people-with-diabetes
- MRA potassium-monitoring gap:
  https://www.ahajournals.org/doi/10.1161/CIRCHEARTFAILURE.113.000709
- RASi discontinuation after hyperkalemia:
  https://www.nature.com/articles/s41440-025-02218-8
- Human vancomycin pilot:
  https://doi.org/10.1038/s41587-026-03010-w
- Continuous ketone drift warning:
  https://doi.org/10.2196/85548
- Diagnostic blood-loss review:
  https://doi.org/10.3390/jcm11020320
- Continuous sensor waste:
  https://pmc.ncbi.nlm.nih.gov/articles/PMC11662339/

