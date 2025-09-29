import json
import csv
import sys

def load_areas_txt(txt_path):
	areas = {}
	with open(txt_path, encoding='utf-8') as f:
		reader = csv.reader(f, delimiter='\t')
		for row in reader:
			if len(row) < 7:
				continue
			name = row[0].strip().lower()

			# add "powiat" (district) information
			if "powiat" not in name:
				name = f"powiat {name}"

			try:
				area_km2 = float(row[4].strip().replace(',', '.').replace(' ', ''))
				area_ha = area_km2 * 100
				area_km2 = round(area_km2, 2)
				area_ha = round(area_ha, 2)

			except ValueError:
				continue
			population = float(row[5].strip().replace(',', '.').replace(' ', ''))
			density = float(row[6].strip().replace(',', '.').replace(' ', ''))
			areas[name] = {
				'headquarters': row[1].strip(),
				'plates': row[2].strip(),
				'province': row[3].strip(),
				'area_km2': area_km2,
				'area_ha': area_ha,
				'population': population,
				'density': density,
            }
	return areas

def update_json(json_path, areas_txt_path, output_path=None):
	with open(json_path, encoding='utf-8') as f:
		data = json.load(f)

	areas = load_areas_txt(areas_txt_path)

	updated = 0
	for feature in data.get('features', []):
		props = feature.get('properties', {})
		nazwa = props.get('nazwa', '').strip().lower()
		if nazwa in areas:
			areas[nazwa]['id'] = props.get('id')
			areas[nazwa]['nazwa'] = props.get('nazwa')

            # remove all properties not in areas
			for key in list(props.keys()):
				if key not in areas[nazwa]:
					del props[key]
            # Add missing properties from areas
			props.update(areas[nazwa])

			updated += 1

	print(f"Updated {updated} areas.")
	out_path = output_path or json_path
	with open(out_path, 'w', encoding='utf-8') as f:
		json.dump(data, f, ensure_ascii=False, indent=2)

# if __name__ == "__main__":
# 	if len(sys.argv) < 3:
# 		print("Usage: python script-to-update-areas.py <areas.txt> <abstract-areas.json> [output.json]")
# 		sys.exit(1)
# 	areas_txt_path = sys.argv[1]
# 	json_path = sys.argv[2]
# 	output_path = sys.argv[3] if len(sys.argv) > 3 else None
# 	update_json(json_path, areas_txt_path, output_path)
update_json("E:\\Projects\\git-repos\\rolnopol-app-poc\\public\\data\\abstract-areas.json", "E:\\Projects\\git-repos\\rolnopol-app-poc\\public\\data\\areas.txt", "E:\\Projects\\git-repos\\rolnopol-app-poc\\public\\data\\abstract-areas.json")