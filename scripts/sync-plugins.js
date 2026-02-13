import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PLUGIN_DIR = path.join(__dirname, '../plugin-examples');

console.log("🚀 Starting Plugin Sync...");

// Get all directories in the plugin-examples folder
const plugins = fs.readdirSync(PLUGIN_DIR).filter(file => {
    return fs.statSync(path.join(PLUGIN_DIR, file)).isDirectory();
});

for (const folder of plugins) {
    const pluginPath = path.join(PLUGIN_DIR, folder);
    const pluginJsonPath = path.join(pluginPath, 'plugin.json');

    if (!fs.existsSync(pluginJsonPath)) {
        console.warn(`⚠️  Skipping '${folder}': No plugin.json found.`);
        continue;
    }

    try {
        const pluginJson = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));

        let remote = '';
        if (typeof pluginJson.repository === 'string') {
            remote = pluginJson.repository;
        } else if (pluginJson.repository && pluginJson.repository.url) {
            remote = pluginJson.repository.url;
        }

        if (!remote) {
            console.warn(`⚠️  Skipping '${folder}': No 'repository' field in plugin.json.`);
            continue;
        }

        console.log(`\n🔄 Syncing '${folder}' to ${remote}...`);

        // Construct the prefix path relative to the root
        const prefix = `plugin-examples/${folder}`;

        // Push to the remote's main branch
        execSync(`git subtree push --prefix="${prefix}" "${remote}" main`, { stdio: 'inherit' });

        console.log(`✅ '${folder}' synced successfully!`);

    } catch (error) {
        console.error(`❌ Failed to sync '${folder}':`, error.message);
    }
}

console.log("\n✨ Sync complete!");
