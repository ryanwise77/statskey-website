# CBM G1 — Build and Validation

## Build rule

The project advances by evidence, not by calendar. A passed chemistry ladder
does not unlock skin. It unlocks the next engineering test.

## Stage 0 — Freeze records and safety

Before ordering:

1. create material, reagent, firmware, and calibration lot identifiers;
2. place every hazardous solvent, acid, ionophore, enzyme, and sharps step
   under the host laboratory's EHS procedures;
3. define the raw-data schema and immutable test IDs;
4. confirm the selected instruments' actual cable and cell topology;
5. record every unverified vendor statement as an assumption, not a spec.

Minimum record per run:

```text
run_id, timestamp_utc, operator, device_serial, cartridge_serial,
tile_id, chemistry_lot, electrode_lot, reference_lot,
instrument_serial, firmware_commit, method_version,
matrix_recipe, matrix_lot, temperature_c, analyte, concentration,
raw_time_s, raw_voltage_v, raw_current_a,
converted_value, uncertainty, quality_state, quality_reasons
```

## Stage 1 — Electrical truth fixture

### Build

- PalmSens reader for deposition and amperometry;
- two EVAL-ADA4530-1RZ boards or equivalent guarded electrometer channels;
- ADS124S08EVM;
- shielded fixture with switchable 10 Mohm, 100 Mohm, and 1 Gohm sources;
- ET073-1 references for electrochemical comparison.

### Test

1. Shorted-input noise and offset.
2. Known voltage through each source resistance.
3. Step response and settling.
4. Adjacent-channel injection.
5. 8 h and 24 h drift.
6. 20–40 °C temperature sweep.
7. humidity screen.
8. BLE/radio and USB/charger interference.

### Gate E

- ≤0.5 mV loading error at 1 Gohm;
- repeatable settling time;
- no unmodeled radio or charge artifact;
- raw traces and fixture design archived.

Failing Gate E stops quantitative potassium work.

## Stage 2 — Commercial-electrode G0

The DRP-8X220AT is **eight independent three-electrode cells**. Each cell has
its own Au working, Au counter, and silver pseudo-reference. Do not wire it as
one shared-reference eight-WE cartridge by assumption.

### Lane allocation

| Cell | Chemistry |
| --- | --- |
| 1 | glucose |
| 2 | beta-hydroxybutyrate |
| 3 | lactate |
| 4 | glucose duplicate, separate deposition lane |
| 5 | sodium ISE |
| 6 | potassium ISE |
| 7 | pH |
| 8 | blank / process control |

For ISE characterization, compare the on-card silver pseudo-reference against
ET073-1 and the guarded electrometer path. The PalmSens mux result is useful as
a comparator, not automatically the truth value.

### Bring-up order

1. Photograph and electrically inspect each array.
2. Establish a bare-gold baseline.
3. Run all electrodeposition processes before enzyme immobilization.
4. Build one chemistry at a time and prove its response before multiplexing.
5. Lock the method version only after blank and reference behavior are known.
6. Build three independent arrays before claiming reproducibility.

### Per-channel ladders

- glucose: 0, 2, 5, 10, 15, 20 mmol/L;
- BHB: 0, 0.1, 0.5, 1.0, 1.5, 3.0, 5.0, 8.0 mmol/L;
- lactate: 0, 0.5, 1, 2, 5, 10, 20 mmol/L;
- sodium: 5, 20, 50, 100, 140, 160 mmol/L;
- potassium: 1, 2.5, 3.0, 3.5, 4.0, 5.0, 6.0, 7.0, 10 mmol/L;
- pH: 4.5, 5.5, 6.5, 7.0, 7.4, 8.0, 8.5.

Randomize up/down order after the first scouting run to expose hysteresis.
Run at the controlled temperatures required by the model.

### Interference matrix

At minimum:

- enzyme lanes: ascorbate, acetaminophen, urate, glucose, lactate, BHB, and
  pH/temperature shifts at plausible matrix concentrations;
- ion lanes: Na, K, Ca, Mg, NH4 where relevant, pH, ionic strength, and
  reference chloride variation;
- all lanes: partial wetting, bubbles, drying, motion/lead disturbance, and
  temperature transient.

### Drift sequence

1. fresh calibration;
2. 2 h continuous;
3. 8 h;
4. 24 h;
5. 72 h only after 24 h passes;
6. post-run calibration to separate sensitivity loss from offset drift.

### Gate C

Per chemistry, all three independent arrays must show:

- predefined linear or mechanistic fit over the target range;
- residuals without an unmodeled concentration pattern;
- acceptable lot and lane reproducibility;
- interference response inside the allocated error budget;
- a fault that is visible to the quality logic before it becomes a displayed
  false value;
- retained post-run calibration within the channel's limit.

No aggregate "panel accuracy" is calculated by averaging unlike analytes.

## Stage 3 — Confidence-gating demonstration

Implement the state machine on recorded G0 traces before wearable firmware.

Induce, label, and detect:

- one glucose lane partially dry while the duplicate remains wet;
- blank baseline shift;
- reference offset step;
- high-Z input leakage;
- temperature step;
- disconnected or intermittent contact;
- out-of-range response;
- stale calibration;
- BHB sensitivity decline.

### Gate Q

For every induced fault:

- the intended channel becomes null or degraded;
- unaffected channels remain available only when their own gates pass;
- the raw sample remains stored;
- the output names the actual reason;
- there is no fallback that silently substitutes a prediction for a failed
  sensor.

## Stage 4 — Custom-part RFQs

Release only after Gates E, C, and Q:

1. CP-01 guarded interface daughterboard to an EE reviewer and PCB assembler;
2. CP-02 polymer tile to a microfabrication facility;
3. CP-03 metal-tile alternate to ZorayPT and a second qualified vendor;
4. CP-04 flex to at least two flex/medical converters;
5. CP-07 die cuts to a converter familiar with medical tapes;
6. shell fit-check to the local print facility.

Every RFQ includes:

- drawing revision;
- material and finish;
- prohibited exposed materials;
- dimensions/tolerances;
- lot quantity;
- inspection data requested;
- cleaning, packaging, and traceability;
- STEP and 2D return files;
- explicit statement that the order is a nonsterile research prototype unless
  a validated process is separately quoted.

## Stage 5 — Mechanical cartridge

Build inert, uncoated cartridges first.

1. Verify the populated Biocoin, four 855 headers, daughterboard, battery
   cradle, harness, and shell against the frozen axial stack.
2. Verify 12-contact keying, 817 working height, four compression stops, and
   snap-hook retention.
3. Run 500 mate/demate cycles.
4. Run continuity during flex and motion.
5. Run sweat-analog ingress around the dry field.
6. Measure insertion depth and 5/6-or-better needle success per tile in the
   locked phantom.
7. Measure force and inspect every needle after repeated insertions.

### Gate M

- no dry-field ingress;
- no intermittent contact;
- no battery compression or antenna violation;
- no needle fracture or unsafe deformation;
- tile and passivation alignment inside tolerance.

## Stage 6 — Functional G1 cartridge

1. Process tiles separately by chemistry class.
2. Characterize each tile before integration.
3. Bond tiles to the flex/carrier.
4. Install CE and independently made RE-A/RE-B.
5. Laminate barrier/passivation.
6. Re-run continuity, isolation, reference offset, and calibration.
7. Mate to the puck and repeat all G0 ladders in artificial ISF.
8. Compare G1 effective area and response with G0; do not reuse G0 slopes.
9. Repeat induced-fault Gate Q on the physical cartridge.

### Gate W0

- all G1 channels independently calibrated in artificial ISF;
- RE pair inside drift limit;
- no electrical or chemical cross-talk outside budget;
- quality logic suppresses induced failures;
- complete raw data and lot records.

## Stage 7 — Packaging, sterilization, and biological program

Sterilization can change enzymes, polymers, reference reservoirs, adhesives,
and electrode surfaces. "EtO compatible" on a tape data sheet is not a device
sterilization validation.

Required before a human protocol:

- biological evaluation plan under the current FDA/ISO 10993 framework;
- chemical characterization and toxicological risk assessment of the final
  contacting assembly;
- sterilization method feasibility, dose/residuals, and post-process
  analytical performance;
- package integrity, shelf-life, bioburden/endotoxin strategy as applicable;
- insertion, fracture, retained-fragment, irritation, sensitization, and
  misuse risk analysis;
- electrical and battery safety plan;
- approved manufacturing and traceability records.

## Stage 8 — Human research governance

Do not treat "self-test" as an exemption.

Before any volunteer or investigator wears a functional microneedle cartridge:

1. sponsor/investigator documents the device and intended study;
2. IRB reviews and approves the protocol and risk determination;
3. significant-risk versus nonsignificant-risk / IDE status is resolved;
4. informed consent, monitoring, stop rules, comparator schedule, and adverse
   event procedures are approved;
5. investigational labeling prohibits diagnosis and treatment use.

The first protocol should be short, supervised, and paired with accepted
comparators. It should test safety, signal presence, lag, and failure
detection—not claim a consumer product.

## Stage 9 — Claim ladder

| Passed evidence | Maximum honest claim |
| --- | --- |
| G0 ladder only | chemistry responds on commercial electrodes in artificial ISF |
| G1 W0 only | integrated research prototype responds in artificial ISF |
| ex-vivo / phantom | insertion and signal survive the specified model |
| approved short human feasibility | exploratory human ISF signal under the protocol |
| dense paired study | analyte-specific trend/lag performance in that population |
| pivotal/regulatory evidence | only the indications accepted by the regulator |

The website must remain at the row the data have actually reached.

