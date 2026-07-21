// CBM G1 — mechanically integrated assembly
// Units: millimetres
//
// Physical source of truth:
//   - actual upstream Biocoin v1.3 mesh
//   - upstream-exact Mill-Max 855 docking headers
//   - low-profile Mill-Max 817 cartridge connector
//   - offset CP1240 battery with JST harness
//   - full 38 mm guarded daughterboard
//   - captured board, compression stops, gasket, and cartridge snap hooks
//
// Modes: "product" | "cutaway" | "exploded" | "electronics" |
//        "cartridge" | "daughterboard" | "shell"

$fn = 72;
render_mode = "product";
show_labels = true;

// ---- frozen product envelopes -----------------------------------------------
shell_od = 44;
shell_h = 19.0;
shell_wall = 1.5;
shell_inner_d = shell_od - 2*shell_wall;

daughter_od = 38;
daughter_h = 0.8;
daughter_z = 2.24;
daughter_top = daughter_z + daughter_h;

// Upstream Mill-Max 855 headers: 6.782 free, 1.397 stroke, 6.08 working.
biocoin_header_working = 6.08;
biocoin_pcb_bottom = daughter_top + biocoin_header_working;
// Upstream STEP PCB bottom is z=-0.96, so this shift places it at 9.12.
biocoin_source_shift_z = biocoin_pcb_bottom + 0.96;

// Mill-Max 817 cartridge connector: 2.54 free, 0.30 working compression.
cartridge_connector_working = 2.24;
contact_pitch = 2.54;

battery_d = 12.1;
battery_h = 4.0;
battery_x = -11.5;
battery_y = 0;
battery_z = 12.95;

cartridge_od = 40;
adhesive_od = 54;
sensor_field_od = 32;
tile_w = 3.5;
tile_l = 5.0;
tile_h = 0.45;
tile_radius = 12.0;
needle_h = 1.0;
needle_d = 0.30;

// ---- palette ---------------------------------------------------------------
ink        = [0.92,0.97,0.98];
graphite   = [0.055,0.075,0.090];
graphite_2 = [0.095,0.125,0.145];
titanium   = [0.38,0.44,0.47];
pcb_c      = [0.025,0.32,0.22];
daughter_c = [0.018,0.43,0.31];
gold_c     = [0.92,0.66,0.18];
silver_c   = [0.76,0.81,0.84];
adh_c      = [0.78,0.76,0.70,0.82];
flex_c     = [0.72,0.43,0.08,0.94];
carrier_c  = [0.72,0.78,0.80];
gasket_c   = [0.15,0.75,0.59];
enzyme_c   = [1.00,0.43,0.18];
ketone_c   = [0.95,0.20,0.43];
ion_c      = [0.18,0.58,1.00];
ph_c       = [0.52,0.40,1.00];
qc_c       = [0.47,0.55,0.61];
ref_c      = [1.00,0.82,0.31];
wire_red   = [0.80,0.08,0.07];
wire_black = [0.04,0.05,0.06];

channels = [
  ["GLC",enzyme_c],["BHB",ketone_c],["LAC",enzyme_c],["DUP",qc_c],
  ["NA",ion_c],["K",[0.08,0.74,1.0]],["PH",ph_c],["BLK",qc_c]
];

// ---- primitives ------------------------------------------------------------
module ring(od,id,h) {
  difference() {
    cylinder(d=od,h=h);
    translate([0,0,-0.1]) cylinder(d=id,h=h+0.2);
  }
}

module rounded_disc(d,h,bevel=0.7) {
  union() {
    translate([0,0,bevel]) cylinder(d=d,h=max(0.01,h-2*bevel));
    cylinder(d1=d-2*bevel,d2=d,h=bevel);
    translate([0,0,h-bevel]) cylinder(d1=d,d2=d-2*bevel,h=bevel);
  }
}

module rounded_box(size=[10,5,1],r=1,center=true) {
  translate(center ? [0,0,-size[2]/2] : [size[0]/2,size[1]/2,0])
    linear_extrude(size[2])
      offset(r=r)
        square([size[0]-2*r,size[1]-2*r],center=true);
}

module label(txt,pos,size=1,clr=ink) {
  if (show_labels)
    color(clr) translate(pos)
      linear_extrude(0.08)
        text(txt,size=size,halign="center",valign="center",
             font="Liberation Sans:style=Bold");
}

module wire_segment(a,b,d=0.45,clr=wire_red) {
  color(clr) hull() {
    translate(a) sphere(d=d);
    translate(b) sphere(d=d);
  }
}

module screw_head(a,z=18.55) {
  rotate([0,0,a]) translate([19.0,0,z]) {
    color([0.20,0.25,0.28]) cylinder(d=2.4,h=0.45);
    color([0.05,0.06,0.07]) translate([0,0,0.42])
      rotate([0,0,30]) cylinder(d=1.15,h=0.06,$fn=6);
  }
}

// ---- cartridge -------------------------------------------------------------
module needle_cluster(clr,z=-0.65) {
  for (ix=[-0.62,0.62])
    for (iy=[-1.20,0,1.20])
      color(clr) translate([ix,iy,z-needle_h])
        cylinder(h=needle_h,d1=0.045,d2=needle_d);
}

module sensor_tile(index=0,z=-0.65,labels=true) {
  clr=channels[index][1];
  color([0.12,0.15,0.17])
    translate([-tile_w/2,-tile_l/2,z]) cube([tile_w,tile_l,tile_h]);
  color(clr)
    translate([-tile_w/2+0.18,-tile_l/2+0.18,z-0.10])
      cube([tile_w-0.36,tile_l-0.36,0.10]);
  needle_cluster(clr,z);
  if(labels) label(channels[index][0],[0,0,z+tile_h+0.06],0.62,ink);
}

module working_tiles(z=-0.65,labels=true) {
  for(i=[0:7])
    rotate([0,0,i*45]) translate([0,tile_radius,z])
      rotate([0,0,-i*45]) sensor_tile(i,0,labels);
}

module central_electrodes(z=-0.65,labels=true) {
  color([0.12,0.15,0.17]) translate([-1.6,-2.4,z])
    cube([3.2,4.8,tile_h]);
  needle_cluster(silver_c,z);
  if(labels) label("CE",[0,0,z+tile_h+0.06],0.60,ink);

  for(side=[-1,1]) {
    x=side*3.4;
    color([0.12,0.15,0.17]) translate([x-0.85,-1.65,z])
      cube([1.7,3.3,tile_h]);
    for(iy=[-0.75,0.75])
      color(ref_c) translate([x,iy,z-needle_h])
        cylinder(h=needle_h,d1=0.05,d2=needle_d);
    if(labels) label(side<0?"RE-A":"RE-B",
      [x,0,z+tile_h+0.06],0.48,[0.10,0.11,0.10]);
  }
}

module flex_layer(z=-0.20) {
  color(flex_c) translate([0,0,z]) cylinder(d=36,h=0.20);
  for(i=[0:7]) {
    a=i*45;
    color(gold_c) rotate([0,0,a])
      translate([-0.09,2.5,z+0.20]) cube([0.18,10.8,0.04]);
  }
}

module passivation(z=-0.705) {
  color([0.86,0.91,0.94,0.46]) difference() {
    translate([0,0,z]) cylinder(d=38,h=0.055);
    for(i=[0:7])
      rotate([0,0,i*45])
        translate([-tile_w/2-0.12,tile_radius-tile_l/2-0.12,z-0.1])
          cube([tile_w+0.24,tile_l+0.24,0.3]);
    translate([-1.8,-2.6,z-0.1]) cube([3.6,5.2,0.3]);
    for(x=[-3.4,3.4])
      translate([x-1,-1.8,z-0.1]) cube([2,3.6,0.3]);
  }
}

module pad_field(z=0) {
  color(graphite_2) translate([0,0,z+0.17])
    rounded_box([18.5,8.7,0.34],1.4,true);
  for(r=[0:1]) for(c=[0:5]) {
    x=(c-2.5)*contact_pitch;
    y=(r-0.5)*contact_pitch;
    color(gold_c) translate([x,y,z+0.35])
      rounded_box([1.55,1.80,0.08],0.48,true);
  }
  // Asymmetric mechanical datum, separate from the electrical grid.
  color(gasket_c) translate([10.1,0,z+0.22]) cylinder(d=1.5,h=0.7);
}

module contact_gasket(z=0.38) {
  color(gasket_c) difference() {
    translate([0,0,z]) rounded_box([22.5,12.0,0.40],2.2,true);
    translate([0,0,z-0.1]) rounded_box([19.0,8.2,0.65],1.2,true);
  }
}

module cartridge_frame(z=-0.50) {
  // Outer structural ring and snap-latch lip; sensing field remains open.
  color(carrier_c) translate([0,0,z]) ring(cartridge_od,34,0.70);
  color(graphite_2) translate([0,0,z+0.52]) ring(40.0,37.6,0.42);
  // Three latch lands under the reusable reader hooks.
  for(a=[0,120,240])
    rotate([0,0,a]) translate([18.3,-2.2,z+0.40])
      color(graphite_2) cube([2.0,4.4,0.70]);
}

module adhesive_layer(z=-0.87) {
  color(adh_c) translate([0,0,z]) ring(adhesive_od,34,0.32);
}

module cartridge(zoff=0,labels=false) {
  translate([0,0,zoff]) {
    adhesive_layer();
    passivation();
    working_tiles(-0.65,labels);
    central_electrodes(-0.65,labels);
    cartridge_frame();
    flex_layer();
    pad_field();
    contact_gasket();
  }
}

// ---- interface daughterboard and connectors --------------------------------
module header_855(center=[0,0],contacts=10,rotation=0,z0=daughter_top) {
  cols=contacts/2;
  pitch=1.27;
  rotate([0,0,rotation]) translate([center[0],center[1],0]) {
    color([0.07,0.08,0.09])
      translate([0,0,z0+0.35])
        rounded_box([(cols-1)*pitch+1.45,2.7,0.70],0.35,true);
    for(r=[-0.635,0.635]) for(c=[0:cols-1]) {
      x=(c-(cols-1)/2)*pitch;
      color(gold_c) translate([x,r,z0])
        cylinder(d=0.48,h=biocoin_header_working);
      color([0.82,0.88,0.90]) translate([x,r,z0+biocoin_header_working-0.9])
        cylinder(d1=0.28,d2=0.18,h=0.9);
    }
  }
}

module cartridge_connector_817() {
  cols=6;
  color([0.065,0.075,0.082])
    translate([0,0,daughter_z-0.32])
      rounded_box([15.7,4.15,0.64],0.45,true);
  for(r=[0:1]) for(c=[0:5]) {
    x=(c-2.5)*contact_pitch;
    y=(r-0.5)*contact_pitch;
    color(gold_c) translate([x,y,0])
      cylinder(d=0.52,h=cartridge_connector_working);
    color([0.82,0.88,0.90]) translate([x,y,0])
      cylinder(d1=0.19,d2=0.31,h=0.72);
  }
}

module daughterboard(zoff=0,labels=true) {
  translate([0,0,zoff]) {
    color(daughter_c) translate([0,0,daughter_z])
      rounded_disc(daughter_od,daughter_h,0.25);
    // Six guarded LMP7721 islands, long axis tangential.
    for(i=[0:5]) {
      a=i*60;
      rotate([0,0,a]) translate([15.8,0,daughter_top+0.75])
        color([0.035,0.045,0.050])
          cube([3.9,4.9,1.50],center=true);
      rotate([0,0,a]) translate([15.8,0,daughter_top+1.52])
        color(gold_c) ring(4.5,4.1,0.03);
    }
    // Buffered-output ADC and local passives.
    color([0.035,0.045,0.050])
      translate([0,0,daughter_top+0.50]) cube([5,5,1.0],center=true);
    for(a=[45,135,225,315])
      rotate([0,0,a]) translate([5.0,0,daughter_top+0.20])
        color([0.70,0.72,0.66]) cube([1.2,0.65,0.4],center=true);

    // Exact upstream docking-header locations, centered to the STEP.
    header_855([-4.88, 7.15],8,90);
    header_855([-0.51, 7.15],8,90);
    header_855([ 1.01,-9.79],10,0);
    header_855([ 1.01,-4.49],10,0);
    cartridge_connector_817();
    if(labels) label("GUARDED INTERFACE PCB",[0,-17.0,daughter_top+0.1],
      0.62,[0.55,1.0,0.84]);
  }
}

// ---- actual Biocoin, board capture, battery and harness ---------------------
module biocoin(zoff=0,labels=true) {
  color(pcb_c) translate([-12.3985,-12.9943,biocoin_source_shift_z+zoff])
    import("vendor/Biocoin_v1.3.stl",convexity=12);
  if(labels) label("BIOCOIN v1.3",[0,0,12.20+zoff],0.85,[0.64,1.0,0.84]);
}

module board_capture(zoff=0) {
  // Four shell-supported edge clips, derived from the upstream fixture concept.
  for(a=[45,135,225,315])
    rotate([0,0,a]) translate([15.15,0,0]) {
      color(graphite_2)
        translate([-0.75,-1.7,daughter_top+zoff])
          cube([1.5,3.4,7.65]);
      color(graphite_2)
        translate([-1.45,-1.7,10.15+zoff])
          cube([2.2,3.4,0.65]);
    }
}

module battery_cradle(zoff=0) {
  // Shell-supported cradle keeps the metal cell off the populated PCB.
  color(graphite_2) translate([battery_x,battery_y,12.75+zoff])
    ring(14.0,12.25,0.55);
  color(graphite_2) hull() {
    translate([-15.3,4.0,13.02+zoff]) cube([1.1,1.1,0.55],center=true);
    translate([-19.0,7.0,13.02+zoff]) cube([1.1,1.1,0.55],center=true);
  }
  color(graphite_2) hull() {
    translate([-15.3,-4.0,13.02+zoff]) cube([1.1,1.1,0.55],center=true);
    translate([-19.0,-7.0,13.02+zoff]) cube([1.1,1.1,0.55],center=true);
  }
}

module battery_and_harness(zoff=0,labels=true) {
  battery_cradle(zoff);
  color(silver_c) translate([battery_x,battery_y,battery_z+zoff])
    rounded_disc(battery_d,battery_h,0.35);
  color([0.09,0.11,0.12]) translate([battery_x,battery_y,battery_z+3.35+zoff])
    ring(10.5,8.0,0.12);

  // Tabbed-cell leads to the actual J1 JST battery-header location.
  wire_segment([battery_x+2.0,-2.0,battery_z+0.35+zoff],
               [-5.5,-5.0,12.65+zoff],0.42,wire_red);
  wire_segment([-5.5,-5.0,12.65+zoff],
               [5.33,-7.95,10.80+zoff],0.42,wire_red);
  wire_segment([battery_x+1.0,-2.6,battery_z+0.25+zoff],
               [-6.2,-5.8,12.40+zoff],0.42,wire_black);
  wire_segment([-6.2,-5.8,12.40+zoff],
               [5.33,-8.45,10.60+zoff],0.42,wire_black);
  color([0.93,0.93,0.88])
    translate([5.33,-8.20,10.50+zoff]) cube([2.8,2.1,1.2],center=true);
  if(labels) label("CP1240 · 50 mAh",
    [battery_x,battery_y,battery_z+battery_h+0.10+zoff],0.62,[0.10,0.12,0.13]);
}

// ---- enclosure, hard stops and cartridge latches ---------------------------
module compression_stops() {
  for(x=[-10.7,10.7]) for(y=[-4.8,4.8])
    color(graphite_2) translate([x,y,0.38])
      cylinder(d=1.6,h=daughter_z-0.38);
}

module cartridge_hooks() {
  // Three reusable cantilever hooks engage the cartridge's outer latch lands.
  for(a=[0,120,240])
    rotate([0,0,a]) translate([20.1,-1.5,0.05]) {
      color(graphite_2) cube([1.2,3.0,2.65]);
      color(graphite_2) translate([-1.1,0,0])
        cube([1.4,3.0,0.65]);
    }
}

module lower_chassis(cut=false,zoff=0) {
  color(graphite_2) difference() {
    translate([0,0,0.20+zoff]) ring(shell_od,40.5,9.5);
    if(cut) {
      translate([0,-24,-1+zoff]) cube([24,48,22]);
      translate([-24,-24,-1+zoff]) cube([48,24,22]);
    }
  }
  translate([0,0,zoff]) {
    compression_stops();
    cartridge_hooks();
    board_capture();
  }
}

module shell_outer(cut=false,zoff=0,transparent=false) {
  clr=transparent ? [0.07,0.10,0.12,0.28] : graphite;
  color(clr) difference() {
    translate([0,0,0.20+zoff]) rounded_disc(shell_od,shell_h-0.20,1.55);
    translate([0,0,1.10+zoff])
      cylinder(d=shell_inner_d,h=shell_h-2.10);
    // Cartridge/contact opening through the base.
    translate([0,0,-0.1+zoff]) cylinder(d=25.0,h=3.2);
    if(cut) {
      translate([0,-24,-1+zoff]) cube([24,48,24]);
      translate([-24,-24,-1+zoff]) cube([48,24,24]);
    }
  }
  color([0.16,0.23,0.26]) translate([0,0,9.25+zoff])
    ring(shell_od+0.05,shell_od-0.75,0.55);
  for(a=[30,150,270]) screw_head(a,18.48+zoff);
  if(!cut && show_labels)
    label("CBM",[0,1.0,shell_h+0.04+zoff],2.1,[0.66,1.0,0.88]);
}

module electronics(zoff=0,labels=true) {
  daughterboard(zoff,labels);
  board_capture(zoff);
  biocoin(zoff,labels);
  battery_and_harness(zoff,labels);
}

// ---- scenes ----------------------------------------------------------------
module product_scene() {
  cartridge(0,false);
  shell_outer(false,0,false);
}

module cutaway_scene() {
  cartridge(0,false);
  lower_chassis(true);
  electronics(0,true);
  shell_outer(true,0,true);
}

module electronics_scene() {
  cartridge(0,false);
  lower_chassis(false);
  electronics(0,true);
}

module exploded_scene() {
  cartridge(-5,true);
  lower_chassis(false,0);
  daughterboard(8,true);
  board_capture(8);
  biocoin(23,true);
  battery_and_harness(36,true);
  shell_outer(false,58,false);
}

module cartridge_scene() {
  cartridge(1.65,true);
}

if(render_mode=="product") product_scene();
else if(render_mode=="cutaway") cutaway_scene();
else if(render_mode=="exploded") exploded_scene();
else if(render_mode=="electronics") electronics_scene();
else if(render_mode=="cartridge") cartridge_scene();
else if(render_mode=="daughterboard") daughterboard(0,true);
else if(render_mode=="shell") shell_outer(false,0,false);
else product_scene();
