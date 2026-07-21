# CBM G1 — Custom Parts Build Specification

Status: research prototype. Dimensions are millimetres unless noted.

This is a fabrication specification, not permission for on-body use. Parts
that penetrate or contact tissue are released only to artificial-ISF,
mechanical phantom, and ex-vivo work until the governance gate in
`06_BUILD_AND_VALIDATION.md` is met.

## CP-01 — Guarded interface daughterboard

### Function

Add six independently guarded femtoamp buffers, differential conversion, the
Biocoin board-to-board interface, and the cartridge spring connector beneath
the open-source Biocoin without changing its PCB.

### Geometry

- full-disc OD: 38.0 ± 0.10;
- finished thickness: 0.80 ± 0.08;
- six high-Z input islands centered at radius 15.80, spaced at 60 degrees;
- minimum nominal package-to-board-edge clearance: 1.25;
- no unguarded copper, via, test pad, silkscreen, solder-mask edge, or board
  outline within 1.0 of an input node;
- driven guard completely surrounds each input pad and trace on every copper
  layer it traverses;
- route from the cartridge connector to each buffer input: under 8.0;
- ordinary digital, charge, antenna, and switched-power copper stays outside
  the guarded annulus.

### Electrical pattern

Repeat six times for `WE5`, `WE6`, `WE7`, `WE8`, `RE-A`, and `RE-B`:

```text
cartridge input → LMP7721 non-inverting input
LMP7721 output → inverting input (unity follower)
LMP7721 output → driven guard and ADS124S08 input
```

- local decoupling per buffer: 100 nF C0G/X7R plus 1 uF, placed on the supply
  side of the guard boundary;
- ADC: ADS124S08IPBS, buffered outputs only;
- daughterboard-to-Biocoin: the upstream docking footprints and exact mating
  parts (`855-22-010-10-001101` x2 and
  `855-22-008-10-001101` x2), compressed to 6.08 mm;
- daughterboard-to-cartridge:
  `817-22-012-30-001101`, 12 positions at 2.54 mm pitch, compressed from
  2.54 to 2.24 mm;
- RE-A connection to the AD5940 is switchable and disconnected during the OCP
  phase so AFE input bias does not load the reference.

### Materials and source

- LMP7721MA/NOPB x6, Texas Instruments;
- ADS124S08IPBS x1, Texas Instruments;
- Mill-Max 855 headers x4 in the upstream 10/8/10/8-pad locations;
- Mill-Max 817 12-position spring connector x1;
- 0.8 mm six-layer low-moisture PCB laminate selected with the assembler;
- ENIG is acceptable on dry connector/assembly pads; the guarded input
  surfaces are controlled by leakage testing, not by finish name;
- no tissue-contact exposure.

### Assembly

1. Fabricate the full disc with the four upstream header footprints, centered
   cartridge connector, component courtyards, and any leakage-control slots.
2. Assemble in an ionic-clean process. Do not apply conformal coating over a
   high-Z node until a coating DOE proves lower leakage after humidity aging.
3. Clean to the approved flux-removal process; bake and dry-store.
4. Install the four upstream-exact spring headers and the downward-facing
   12-position connector; measure free height and coplanarity.
5. Seat Biocoin in the four shell-supported edge clips, compressing the 855
   headers by 0.70 mm against J3/J4/J7/J8.
6. Measure leakage before and after mating under power, radio transmission,
   and charger-connected conditions.

### Acceptance

- offset caused by the complete input path with 1 Gohm source: ≤0.5 mV at
  23 ± 2 °C, 40–60% RH;
- channel-to-channel coupling after a 100 mV step: ≤0.2 mV after the locked
  settling time;
- no quality escape after 24 h at the selected high-humidity screening point;
- no measurable change when BLE transmits;
- populated daughterboard height ≤1.60 above its top plane outside the
  intentional 855 header volumes;
- connector coplanarity keeps all 12 cartridge contacts inside the
  2.24 ±0.10 mm working-height stack;
- EE schematic/layout review completed before RFQ release.

The daughterboard is **not** called fabrication-ready until a reviewed schematic and
Gerbers exist. This document freezes the measurable requirements and prevents
false precision where artwork has not yet been designed.

## CP-02 — Modular polymer microneedle working tile

### Frozen geometry

- tile body: 3.5 x 5.0 x 0.45 target;
- array: 2 x 3;
- needle length: 1.00 ± 0.05;
- needle base diameter: 0.30 ± 0.03;
- tip radius: ≤0.025;
- needle pitch: 1.20 ± 0.05;
- all six needles on one tile are electrically common;
- adjacent tiles must exceed 100 Mohm dry isolation at the cartridge level.

### Published 2026 replication route

This route follows the eMPatch primary method and must be executed in a
qualified microfabrication laboratory:

1. Mix SYLGARD 184 PDMS elastomer and curing agent **9:1 by mass**. Stir
   20 min, vacuum-degas 15 min, and cure at 80 °C for 2 h.
2. Laser-machine the 2 x 3 negative mold. The paper's optimized CO2-laser
   starting settings were 2 W, 100 mm/s, and 0.05 mm pitch in drill mode.
   Calibrate depth and tip on witness molds; machine settings are not accepted
   as dimensional inspection.
3. Prepare polystyrene at **300 mg/mL in DMF** in a controlled hood.
4. Immerse/fill the PDMS mold; centrifuge at **5,000 rpm for 5 min**.
5. Dry on a hotplate at **80 °C for 12 h**. Demold without bending the tips.
6. Mask the tile contact region. Sputter approximately **10 nm Cr** at the
   paper's 10 mA / 20 s starting condition, then **150 nm Au** at 25 mA /
   120 s. Thickness is released by witness coupon, not time alone.
7. Attach the tile dry-side contact to the flex landing with the qualified
   anisotropic or conductive-epoxy process. The wet Au and dry interconnect
   must remain electrically connected and fluidically isolated.

### Incoming / in-process QC

- 100% optical inspection for broken, blunt, bridged, or warped needles;
- dimensional sample by calibrated microscope; SEM on process-validation
  lots;
- Cr/Au thickness and sheet resistance on witness coupons;
- continuity tile-to-flex and >100 Mohm isolation tile-to-tile;
- insertion into the locked Parafilm/agarose/skin-phantom stack;
- compression force with safety factor ≥3 against the intended applicator
  load;
- post-insertion coating inspection;
- residual DMF / extractables plan before biological release.

### Source materials

The material rows and vendor links are in `04_SOURCED_BOM.csv`: SYLGARD 184,
research-grade PS, DMF, Cr and Au targets. A research reagent being available
does not make it a medical-grade final material.

## CP-03 — Metal microneedle tile, vendor alternate

Use this path if the molded/sputtered tile fails strength, residual-solvent, or
scale gates.

### RFQ specification

- vendor starting point: ZorayPT `ZPT-SMN-001`, or a qualified equivalent;
- substrate: traceable 316L stainless steel;
- six solid needles per independently isolated tile;
- needle size: 30–36G, 0.70–1.00 long; quote 0.90 nominal first;
- no nickel strike on the wet electrode;
- nickel-free Au coating, target thickness proposed by vendor and verified by
  XRF / cross-section;
- separate Pt counter tile and Ag/AgCl reference substrates;
- tile dry pad compatible with CP-04;
- no claim of sterility unless the validated process and package are included.

### Vendor must return

- material certificates and lot traceability;
- coating chemistry, adhesion layer, nominal/minimum thickness, and
  uniformity;
- dimensional capability and tip-radius distribution;
- electrical isolation method;
- insertion/buckling data and coating integrity after insertion;
- cleaning, packaging, residuals, bioburden, and available ISO 10993 evidence;
- STEP and 2D drawing.

### Incoming acceptance

Same mechanical/electrical tests as CP-02 plus coating pinhole, nickel
screening, adhesion, and corrosion testing in artificial ISF.

## CP-04 — Twelve-net sensing flex and contact boss

### Stack target

- adhesive-less polyimide core: 25 micrometres;
- rolled-annealed copper: 18 micrometres target;
- polyimide coverlay: 25 micrometres plus qualified adhesive;
- finished two-layer flex target: ≤0.20;
- minimum trace/space: 0.10/0.10 or looser wherever possible;
- dry contact pads: hard gold over the vendor's controlled nickel barrier;
- **no nickel, copper, ENIG edge, or conductive adhesive exposed to the wet
  side**.

### Geometry

- sensor disc: 36.0 OD inside the 40.0 structural frame;
- eight 3.5 x 5.0 tile landings on radius 12.0;
- central CE, RE-A, and RE-B landings;
- 12-pad boss: 2 x 6 at 2.54 pitch;
- pad: 1.55 x 1.80 rounded rectangle with 0.35 minimum coverlay gap;
- boss height and reader pocket set for the Mill-Max 817 connector's
  2.24 mm working height; four hard stops prevent overtravel;
- separate off-grid key feature;
- pin 12 routes cartridge-ID resistor to RE/digital return as defined by the
  reviewed reader schematic.

### Fabrication and assembly

1. Flex vendor fabricates and 100% electrically tests open/short.
2. Converter laser-cuts the wet-side barrier and dry-side gasket.
3. Bond tiles in a registration fixture one chemistry class at a time.
4. Cure below the lowest validated temperature limit of the flex, adhesive,
   and previously deposited chemistry.
5. Laminate ARcare 7759 passivation so only the validated sensing length is
   exposed; keep all conductor transitions dry.
6. Inspect continuity, isolation, flatness, and pad coplanarity.

### Acceptance

- contact resistance <100 milliohm per dry path before and after 500
  mate/demate cycles, or a revised evidence-based limit;
- no discontinuity during the locked flex test;
- no leakage bridge in sweat analog across the gasketed contact field;
- alignment of each passivation opening to its tile ±0.10;
- no exposed conductive edge outside the intended electrode.
- three cartridge latch lands withstand at least 17.7 N combined retention
  load (2.5 x the connector's approximately 7.1 N preload) before cycle
  testing.

## CP-05 — Reference A, reference B, and counter

### RE-A starting process

The 2026 eMPatch method is the starting reference construction:

1. sputter the reference tile with silver using the validated thickness
   process;
2. place **10 microlitres of 0.05 M FeCl3** on the silver for **30 s**;
3. rinse three times with deionized water;
4. apply the protective reservoir cocktail: **50 mg NaCl + 79.1 mg PVB in
   1 mL methanol**;
5. dry/condition under the locked process and record initial potential versus
   ET073-1.

RE-B uses the same electrochemical family but is made on a separate tile,
separate lane, and preferably a separate batch. Its purpose is differential
fault detection. A later DOE may deliberately vary reservoir geometry or
matrix; any difference becomes a calibrated design, not an informal change.

### Counter

- central Pt-coated cluster;
- effective wet area initially at least the combined active area required by
  the selected amperometric method;
- release by polarization/compliance testing across the complete analyte
  ladder, not geometric area alone.

### Acceptance

- initial RE offset versus ET073-1 recorded;
- RE-A and RE-B differential drift ≤1 mV over the intended bench interval;
- no cracking/delamination after insertion phantom;
- counter keeps the AFE inside compliance with margin during worst-case
  current.

## CP-06 — Chemistry functionalization

All recipes below are **starting process transfers from primary methods**.
They are not final production recipes until the G0 DOE locks film thickness,
activity, cure, and response on the exact substrate.

### Glucose and glucose-duplicate tile

1. Electrodeposit Prussian Blue by CV from -0.2 to +0.4 V, 20 mV/s, 15
   cycles in fresh 2.5 mM FeCl3 + 2.5 mM K3Fe(CN)6 + 0.1 M KCl in 0.1 M HCl.
2. Rinse DI water and dry.
3. Mix GOx at 10 mg/mL 1:1 by volume with 1 wt% chitosan in 1% acetic acid.
4. Apply the volume established by the G0 area-normalization DOE; eMPatch used
   10 microlitres on its 2 x 3 tile.
5. Dry, then apply 1% PEGDE at the locked volume for crosslink/protection.
6. Fabricate the duplicate in a separate deposition lane so it can expose a
   lane-specific fault.

### BHB tile

Starting process from the 2024 human microneedle work:

1. On the Au/Pt transducer, cast 1 microlitre of 0.2 mM TBO; dry 45 min.
2. Electropolymerize at +0.9 V for 6 min with 400 microlitres 0.1 M PBS,
   pH 7.4; rinse DI water.
3. Apply 1 microlitre of 0.1 mg/mL carboxylated MWCNT in 0.5 wt% chitosan /
   0.1 M acetic acid; air-dry.
4. Apply 1 microlitre of a 1:2 v/v HBD:NAD+ mixture: HBD 2.5 mg/mL and NAD+
   40.0 mM, each in 0.1 M Tris-HCl; include the validated 0.5 wt% chitosan
   matrix. Incubate overnight at 4 °C.
5. Apply 1 microlitre 0.5% chitosan and 1 microlitre 2.0% PVC protective
   layers. Store at 4 °C until the controlled test.

The dopamine-hyaluronic-acid hydrogel route is a separate experiment. Do not
combine its tyrosinase crosslinking with a P4VP patent embodiment and call the
hybrid published.

### Sodium and potassium tiles

1. Electropolymerize PEDOT:PSS on Au using the locked eMPatch starting bath:
   0.2 wt% EDOT + 4 wt% PSS, CV 0.2 to 0.9 V, 50 mV/s, 10 cycles.
2. Cure 80 °C for 1 h **before** adding any enzyme tile to the carrier.
3. Sodium cocktail: 1 mg sodium ionophore X + 0.55 mg Na-TFPB + 33 mg PVC +
   65.45 mg DOS in 660 microlitres THF.
4. Potassium cocktail: 2 mg valinomycin + 0.55 mg sodium tetraphenylborate +
   33 mg PVC + 65.45 mg DOS in 660 microlitres THF.
5. Apply 10 microlitres to the corresponding source-scale tile, or the
   G0-locked volume after area normalization; dry under the validated hood
   process.

### pH tile

Electropolymerize PANI from 0.1 M aniline in 0.1 M HCl by CV -0.2 to +1.0 V,
100 mV/s, 30 cycles. IrOx remains a comparison branch, not an undocumented
substitution.

### Blank tile

The blank must match the physical stack of the channel it corrects while
omitting the recognition element. One universal blank cannot mathematically
correct every chemistry. G1 initially treats it as a nonspecific
electrochemical/background sentinel and validates each subtraction claim
separately.

## CP-07 — Shell, gasket, passivation, and adhesive die cuts

### Reader fit-check shell

- 44.0 OD x 19.0 maximum;
- 1.5 wall target; 41.0 nominal internal diameter;
- actual populated Biocoin STEP controls the board pocket;
- four edge clips derived from the upstream small-battery fixture hold the
  hole-less Biocoin against its docking headers;
- offset battery cradle centers the CP1240 at x=-11.5, clears the entire
  Raytac module body by at least 2.3 nominal, and leaves 0.80 above the highest populated
  component and 1.05 below the inner ceiling;
- tabbed battery connects through JST `ACHR-02V-S` +
  `SACH-003G-P0.2` contacts to Biocoin J1; never solder directly to the cell;
- three PEEK M1.6 enclosure fasteners sit outside the board and antenna
  keepout;
- recessed 12-contact pocket has a drainage path and no sweat trap;
- four compression stops set connector working height independently of the
  gasket;
- three reusable cantilever hooks engage disposable latch lands vertically,
  so contacts do not wipe during installation.

Print Tough 1500 only for fit, drop, and interface iteration. Do not call the
printed shell biocompatible or sealed.

### Cartridge die cuts

- ARcare 7759 passivation: 38.0 OD; openings aligned to each tile; 55
  micrometres nominal excluding liner;
- Solventum 4077 adhesive skirt: 54.0 OD, 34.0 ID starting geometry;
- dry-interface gasket: closed-cell or silicone material chosen after
  extractables/ingress testing; initial 30A silicone is fixture material, not
  a released skin-contact component;
- contact gasket: rounded 22.5 x 12.0 outside / 19.0 x 8.2 inside, 0.50
  uncompressed and 0.40 at the hard stop;
- converter tolerance: ±0.10 around sensor openings and ±0.15 on adhesive OD.

### Acceptance

- dry contact field survives sweat-analog ingress test;
- no adhesive overlaps exposed sensing shafts;
- no sharp edge reaches skin;
- applicator provides repeatable insertion without loading the battery or
  electronics;
- populated nominal stack passes every check in
  `MECHANICAL_FIT_REPORT.md`; any vendor tolerance change reruns the script;
- final assembled device, not individual material brochures, passes the
  biological and sterilization plan.

## CP-08 — Assembly sequence

1. Receive and inspect Biocoin, interface daughterboard, connectors, flex,
   tiles, mechanical parts, and die cuts by lot.
2. Bring up Biocoin and the daughterboard on electrical simulators before
   compressing the board stack.
3. Complete all high-temperature and solvent-heavy tile processes separately.
4. Characterize each tile on a temporary fixture before carrier integration.
5. Bond tile dry contacts to CP-04 in the registration fixture.
6. Install CE, RE-A, and RE-B; remeasure continuity/isolation/reference offset.
7. Laminate wet-side barrier and passivation.
8. Install cartridge-ID component and 12-pad boss.
9. Add gasket and adhesive only after electrochemical acceptance.
10. Mate to the puck through a protected fixture; run the complete dummy,
    calibration, quality-fault, and ingress sequence.
11. Seal and package only under the process being validated.

No failed measurement is repaired by loosening the quality thresholds. The
part or process is corrected and the gate rerun.

