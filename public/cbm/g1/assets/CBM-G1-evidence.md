# CBM G1 — Frontier Evidence

Checked against live sources on 2026-07-19. Evidence levels are intentionally
kept separate:

- **C** — cleared / commercially authorized for the stated use and region
- **H** — human study
- **A** — animal or ex-vivo study
- **V** — in-vitro / engineering validation
- **P** — proposed architecture; not experimentally validated as a whole

## Evidence that changes the design

| Source | Level | What it actually proves | What it does not prove | G1 consequence |
| --- | --- | --- | --- | --- |
| [Abbott Libre Duo, 27 May 2026](https://abbott.mediaroom.com/2026-05-27-Abbott-secures-CE-Mark-for-worlds-first-dual-glucose-ketone-sensing-technology-for-people-with-diabetes) | C, Europe | CE Mark for minute-by-minute glucose + ketone; 15-day adult and 10-day age-2+ versions | U.S. clearance, CBM chemistry transfer, or a six-analyte product | Glucose + ketone is the strongest commercial multi-analyte precedent |
| [eMPatch, Nano-Micro Letters 2026](https://doi.org/10.1007/s40820-026-02095-x) | A/V | Six channels—glucose, uric acid, cholesterol, Na, K, pH—on modular 2 x 3 microneedle tiles; rat interventions; exact fabrication methods | Human accuracy or multi-day six-analyte stability. Continuous stability was reported for 120 min in artificial ISF; 14 days was refrigerated shelf testing | Use modular multi-needle tiles; do not describe the work as a human wearable validation |
| [Biocoin, npj Biosensing 2026](https://doi.org/10.1038/s44328-026-00103-z) and [open hardware](https://github.com/ProfDrewHall/Biocoin) | V | Open 26 mm AD5940+nRF52840 board, more than ten sensor inputs, multimodal measurements, Gerbers/BOM/firmware/software/STEP | A finished CBM reader, clinical accuracy, or femtoamp loading for the G1 potassium budget | Fork the board; add a guarded interface daughterboard using its published dock contacts |
| [Tehrani et al., Nature Biomedical Engineering 2022](https://doi.org/10.1038/s41551-022-00887-1) | H | Integrated reusable electronics + disposable microneedle array; human glucose+lactate or glucose+alcohol demonstrations | Broad-panel human validation | Confirms the reusable/disposable architecture and human feasibility of selected metabolites |
| [Moonla et al., ACS Sensors 2024](https://doi.org/10.1021/acssensors.3c02677) | H | Human microneedle beta-hydroxybutyrate pilot with HBD/NAD+/poly-TBO/CNT/chitosan/PVC stack | Cleared DKA use or long-duration stability | Use the published stack for the first BHB bench lane |
| [Poudineh group, Biosensors and Bioelectronics 2026](https://doi.org/10.1016/j.bios.2026.118640) | H/A | Hydrogel microneedle ketone platform translated from rodents to humans | Production transfer or automatic compatibility with a mixed rigid-metal array | Keep the hydrogel tile as a parallel BHB reliability experiment |
| [Continuous ketone randomized trial, JMIR Diabetes 2026](https://doi.org/10.2196/85548) | H | Seven participants; dynamics detected over 14 days | Stable quantitative 14-day accuracy. Both groups showed progressive decline consistent with drift | Do not claim long-wear BHB until drift is independently solved |
| [SC-MMNEA, The Innovation 2025](https://doi.org/10.1016/j.xinn.2024.100781) | A | Nine analytes in rats and hollow-needle delivery of calibration solutions | Human safety, a passive cartridge, or calibration without a fluid-delivery subsystem | Treat in-situ calibration as a later cartridge class, not a free firmware feature |
| [Adaptyx cortisol abstract, Diabetes 2026](https://doi.org/10.2337/db26-2893-lb) | H | n=3 hydrocortisone challenge + n=3 overnight; eight cortisol molecular switches + eight controls; company reports >400 human in-body hours | Cleared cortisol monitor or a catalog aptamer recipe | Shows continuous cortisol has reached early human feasibility and that control-heavy arrays are not novel |
| [Metyos K-Patch, ASN 2024](https://doi.org/10.1681/asn.2024tnfaf9kc) | V/H usability | Nernstian response and eight-day complex-matrix stability; insertion/ease-of-use in ten volunteers | Paired serum-vs-ISF potassium accuracy in patients | Potassium remains a high-value research channel, not a treatment-facing G1 output |
| [Trimaterial wire-bonded microneedles, IEEE Sensors Letters 2025](https://doi.org/10.1109/lsens.2025.3596869) | V | Cleanroom-free Au/Pt/Ag wire-bonded three-electrode arrays; reported material cost under $2 and Ag/AgCl drift of -3 ± 0.3 mV over 24 h in PBS | Validated skin wear or an eight-tile production process | Viable second-source fabrication route for the custom head |
| [ARcare 7759 passivation study / 2025 pH sensor](https://doi.org/10.3390/bios15080517) | V/A | 55 micrometre medical-grade die-cut passivation around microneedles; ex-vivo insertion and pH work | Device-level biological safety or sterile long wear | Use as a prototype passivation film with assembly-specific validation |

## Exact eMPatch process facts used by G1

The primary 2026 paper reports:

- polystyrene microneedles made in a laser-machined PDMS mold;
- **2 x 3 needles**, each **1,000 micrometres long and 300 micrometres in
  diameter**;
- approximately **10 nm Cr + 150 nm Au** sputtered on working/counter tiles;
- a silver-coated, ferric-chloride-treated reference protected by a
  NaCl/PVB layer;
- SIS carrier at approximately 0.45 mm;
- AD5941, ADS1115, 1P8T selector, STM32L431, CC2540, and 300 mAh battery;
- six hours of electronics runtime in its continuous mode.

These dimensions justify the G1 tile geometry. They do not make the exact
eMPatch chemistry or animal result a CBM result.

## Exact electronics facts used by G1

Biocoin v1.3 publishes:

- board radius 13 mm, area 530 mm2, thickness 0.8 mm, six-layer FR-4;
- AD5940BCBZ-RL AFE;
- Raytac MDBT50Q-1MV2 / nRF52840 BLE module;
- TMUX1104 low-leakage 4:1 mux;
- two TLV8542 low-input-bias dual op-amps;
- a 20-position FFC connector;
- board BOM cost of about $43 at quantity 10 and $36 at quantity 100,
  excluding fabrication, assembly, battery, enclosure, and CBM daughterboard.

The upstream PCB and fixtures are CERN-OHL-W-2.0; firmware and software are
MIT licensed. A fork must preserve the applicable notices and document
modifications.

## Regulatory and biological-safety anchors

- [FDA IDE FAQ](https://www.fda.gov/medical-devices/investigational-device-exemption-ide/faqs-about-investigational-device-exemption):
  investigational device studies need an IDE or a documented exemption; an IRB
  confirms nonsignificant-risk status and abbreviated IDE requirements.
- [FDA recognized consensus standard entry for ISO 10993-1:2025](https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfstandards/detail.cfm?standard__identification_no=47116):
  the 2025 edition is partially recognized; biological evaluation belongs
  inside ISO 14971 risk management.
- Device-level testing must account for final materials, residues,
  sterilization, packaging, contact type, and cumulative duration. A supplier
  saying that one tape or resin is "biocompatible" is not device clearance.

## Claims allowed on the public page

Safe:

- "research-stage";
- "modeled from sourced and published parts";
- "six target chemistries plus two quality-control channels";
- "designed to withhold a channel when quality gates fail";
- "commercial, human, animal, and in-vitro evidence are shown separately."

Not supported:

- "replaces a blood draw";
- "clinical-grade potassium";
- "seven-day six-analyte accuracy";
- "first multi-analyte microneedle patch";
- "first control-channel or fail-closed architecture";
- treatment, dosing, diagnosis, or emergency-alert claims.

