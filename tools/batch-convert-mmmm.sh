#!/usr/bin/env bash
# Batch-convert MMMM .vox files to .vobj.json
# Each file outputs model_0.vobj.json which we rename immediately

set -e
PROJECT=/Users/firatsertgoz/Documents/clawfield
MMMM=$PROJECT/assets/vox/mmmm-full/vox
BUILDINGS=$PROJECT/assets/objects/buildings
PROPS=$PROJECT/assets/objects/props
VEGETATION=$PROJECT/assets/objects/vegetation
VEHICLES=$PROJECT/assets/objects/vehicles

mkdir -p "$BUILDINGS" "$PROPS" "$VEGETATION" "$VEHICLES"

convert_one() {
  local src="$1" outdir="$2" name="$3" vsize="$4" cat="$5"
  if [ -f "$outdir/${name}.vobj.json" ]; then
    echo "  SKIP $name (exists)"
    return
  fi
  npx tsx "$PROJECT/tools/vox-converter.ts" \
    --mode object --input "$src" --output-dir "$outdir" \
    --voxel-size "$vsize" --category "$cat" > /dev/null 2>&1
  if [ -f "$outdir/model_0.vobj.json" ]; then
    mv "$outdir/model_0.vobj.json" "$outdir/${name}.vobj.json"
    echo "  OK   $name"
  else
    echo "  FAIL $name"
  fi
}

echo "=== BUILDINGS ==="
# New houses (we already have house1,5,6,7)
for h in obj_house2 obj_house3 obj_house4 obj_house8; do
  convert_one "$MMMM/${h}.vox" "$BUILDINGS" "$h" 0.25 building
done

# Stores (we already have store01,07,08)
for s in obj_store02 obj_store03 obj_store04 obj_store05 obj_store06 \
         obj_store09 obj_store10 obj_store11 obj_store12 obj_store13 \
         obj_store14 obj_store15 obj_store16 obj_store17; do
  convert_one "$MMMM/${s}.vox" "$BUILDINGS" "$s" 0.25 building
done

# Multi-story buildings
for b in obj_story01 obj_story02 obj_story03 obj_story04 obj_story05 obj_story06; do
  convert_one "$MMMM/${b}.vox" "$BUILDINGS" "$b" 0.25 building
done

echo ""
echo "=== STREET PROPS ==="
for p in obj_stlight1 obj_stlight2 obj_stlight3 \
         obj_trlight1 obj_trlight2 \
         obj_hydrant \
         obj_mailbox obj_mailbox2 \
         obj_newsbox1 obj_newsbox2 obj_newsbox3 \
         obj_cone1 \
         obj_sign1 obj_sign2 obj_sign3 obj_sign4 \
         obj_planter1 obj_planter2 \
         obj_fountain \
         obj_statue1 obj_statue2 \
         obj_container1 obj_container2 \
         obj_rubbish1 obj_rubbish2 \
         obj_trashcan2 obj_trashcan3 \
         obj_bench2 obj_bench3 \
         obj_column1 obj_column2 \
         obj_potty1; do
  convert_one "$MMMM/${p}.vox" "$PROPS" "$p" 0.125 prop
done

echo ""
echo "=== VEHICLES ==="
for v in veh_car1 veh_car2 veh_car3 veh_car4 veh_car5 \
         veh_cab1 veh_bus veh_police1 \
         veh_suv1 veh_suv2 veh_truck2; do
  convert_one "$MMMM/${v}.vox" "$VEHICLES" "$v" 0.15 prop
done

echo ""
echo "=== VEGETATION ==="
for t in obj_tree3 obj_tree4; do
  convert_one "$MMMM/${t}.vox" "$VEGETATION" "$t" 0.2 vegetation
done

echo ""
echo "=== DONE ==="
echo "Buildings:  $(ls $BUILDINGS/*.vobj.json 2>/dev/null | wc -l)"
echo "Props:      $(ls $PROPS/*.vobj.json 2>/dev/null | wc -l)"
echo "Vehicles:   $(ls $VEHICLES/*.vobj.json 2>/dev/null | wc -l)"
echo "Vegetation: $(ls $VEGETATION/*.vobj.json 2>/dev/null | wc -l)"
