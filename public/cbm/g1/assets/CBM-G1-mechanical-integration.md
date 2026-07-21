# CBM G1 — Mechanical Integration

Status: nominal stack collision-checked against the actual upstream Biocoin
STEP on 2026-07-19. See `MECHANICAL_FIT_REPORT.md`.

## Mechanical design rule

Every electrical contact, retained component, sealing surface, and assembly
load has an explicit part and reaction path:

- all twelve cartridge contacts are carried by one retained connector on a
  rigid daughterboard;
- connector free height, working height, compression, and preload come from
  manufacturer data;
- the battery has a shell-supported cradle, antenna keepout, welded tabs, and
  a defined harness;
- the hole-less Biocoin board is captured against its published dock contacts;
- the cartridge frame remains open around the sensing tiles;
- hard stops carry connector compression independently of the gaskets;
- reusable fasteners, cartridge hooks, and separate sealing systems close the
  load paths.

## Assembly architecture

### 1. Disposable cartridge

From skin upward:

1. Solventum 4077 adhesive ring, 54 OD / 34 ID, 0.32 nominal.
2. ARcare 7759 passivation, 0.055, with openings around the validated needle
   exposure.
3. Eight 2 x 3 working-electrode tiles plus central Pt counter and two
   separately fabricated references.
4. Two-layer polyimide sensing flex, 36 OD, with the tile bases bonded to its
   underside.
5. Open 40 OD structural frame; there is no solid plastic disc intersecting
   the tiles.
6. Central 2 x 6 hard-gold pad field at 2.54 pitch plus an off-grid key datum.
7. Three outer latch lands that accept only vertical engagement from the
   reusable puck.

The compressed adhesive skin plane is z=-0.87 and the needle tips are z=-1.65,
leaving 0.78 nominal protrusion.

### 2. Cartridge-to-reader interface

- connector: Mill-Max `817-22-012-30-001101`;
- free height: 2.54;
- modeled working height: 2.24;
- compression: 0.30 of 0.61 available full stroke;
- twelve contacts at 2.54 pitch;
- connector preload: approximately 7.1 N at 60 gf/contact;
- four hard stops, not the gasket or solder joints, define working height;
- three reusable snap hooks target at least 17.7 N combined retention
  (2.5 x preload).

A rounded-rectangular contact gasket surrounds, but does not carry, the
connector load. Contacts engage vertically; they do not scrape across the
cartridge pads.

### 3. Guarded interface daughterboard

- 38 OD x 0.8 full PCB;
- bottom plane z=2.24, top z=3.04;
- six LMP7721 SOIC-8 packages at radius 15.80;
- ADS124S08 in the central component area;
- minimum nominal LMP package-to-edge clearance 1.25;
- downward 817 connector;
- upward Biocoin docking headers at the exact published J3/J4/J7/J8
  coordinates.

The full disc replaces the unrouteable 32 mm annulus. It provides a physical
mount for the cartridge connector, guarded input islands, conversion, and the
published Biocoin interface.

### 4. Daughterboard-to-Biocoin interface

The mating parts are copied from the open-source Biocoin docking-station BOM:

- Mill-Max `855-22-010-10-001101` x2;
- Mill-Max `855-22-008-10-001101` x2.

Their free height is 6.782 and available stroke is 1.397. The assembly models 6.08
working height, 0.70 compression. The Biocoin PCB bottom pad plane is z=9.12.

Four shell-supported clips, adapted from the upstream small-battery fixture,
capture the board edge and provide the compression reaction. The board does
not float on the headers.

### 5. Biocoin and bottom-component clearance

Measured from `Biocoin_v1.3.step`:

- populated envelope: 24.901 x 26.101 x 4.911;
- PCB thickness: 0.960;
- lowest bottom component: 1.888 below the PCB;
- highest top component: 2.063 above the PCB;
- FPC connector: 3.600 x 11.700 x 1.895;
- Raytac module: 15.500 x 10.500 x 2.050.

At the frozen placement:

- populated lowest point: z=7.23;
- populated highest point: z=12.14;
- daughterboard top components: no higher than z=4.64;
- non-interface vertical clearance: 2.59 minimum.

### 6. Battery and harness

- cell: tabbed VARTA CP1240 A4X, 12.1 x 4.0;
- center: x=-11.5, y=0;
- bottom/top: z=12.95 / 16.95;
- support: two shell-supported cradle arms and a lower locating ring;
- highest Biocoin component clearance: 0.81;
- shell inner-ceiling clearance: 1.05;
- radial shell clearance: 2.95;
- XY clearance from the entire Raytac module body: 2.31.

The battery is not balanced on board components and is not centered over the
radio module. Welded cell tabs terminate in JST `ACHR-02V-S` with
`SACH-003G-P0.2` contacts, mating the existing Biocoin J1 header. Direct
soldering to the cell is prohibited.

### 7. Reusable enclosure

- 44 OD x 19.0 exterior;
- 41.0 nominal internal diameter;
- lower chassis carries daughterboard, hard stops, snap hooks, and board
  clips;
- upper cap carries the battery cradle;
- three PEEK M1.6 fasteners close the reusable shell outside the conservative
  board/antenna envelope;
- a separate seam gasket protects the reusable electronics;
- the contact gasket protects only the dry cartridge interface.

## Assembly order

1. Inspect daughterboard, four 855 headers, 817 connector, shell parts, and
   returned vendor CAD.
2. Assemble and electrically qualify the daughterboard by itself.
3. Install the daughterboard into the lower chassis against its locating
   ledge.
4. Seat the four 855 headers and verify free height/coplanarity.
5. Connect the tabbed CP1240 harness to Biocoin J1.
6. Lower Biocoin onto J3/J4/J7/J8 and engage all four board-edge clips.
7. Place the battery into the upper-cap cradle without loading the PCB.
8. Close the cap with the seam gasket and three PEEK fasteners.
9. Verify the 817 tip plane against all four cartridge hard stops.
10. Press an inert cartridge vertically until all three hooks engage.
11. Measure contact resistance, preload, shell deflection, and gasket
    compression before any sensing chemistry is installed.

## Nominal checks that pass

`cad/validate_mechanical_stack.py` checks:

- populated Biocoin and daughterboard radial fit;
- package edge clearance;
- bottom-component/daughterboard clearance;
- battery/component, battery/shell, and battery/radio clearance;
- both spring-connector compression values;
- needle protrusion;
- latch design load.

The script exits nonzero on a failed nominal check and regenerates
`MECHANICAL_FIT_REPORT.md`.

## Still requires physical proof

Nominal CAD cannot prove:

- snap-hook stress, fatigue, and release ergonomics;
- gasket compression set and sweat ingress;
- tolerance-stack coplanarity;
- antenna efficiency after enclosure and body loading;
- battery protection and charging validation;
- microneedle insertion, fracture, or coating survival.

Those remain explicit physical gates—not assumptions hidden by the render.

