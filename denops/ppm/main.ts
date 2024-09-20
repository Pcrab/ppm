import type { Denops, Entrypoint } from "jsr:@denops/std";
import * as fs from "jsr:@std/fs";
import * as path from "jsr:@std/path";
import * as h from "jsr:@denops/std/helper";
import * as v from "jsr:@denops/std/variable";
import * as o from "jsr:@denops/std/option";
import * as f from "jsr:@denops/std/function";
import { assert, is, as, PredicateType } from "jsr:@core/unknownutil";

enum PluginLoadType {
	GIT = "git",
	LOCAL = "local",
}

const isUserDefinedPlugin = is.IntersectionOf([
	is.ObjectOf({
		name: is.String,
		path: is.String,
		opt: as.Optional(is.Boolean),
		hooks: as.Optional(is.ArrayOf(is.Function)),
	}),
	is.UnionOf([
		is.ObjectOf({
			type: as.Optional(is.LiteralOf(PluginLoadType.GIT)),
			branch: as.Optional(is.String),
			commit: as.Optional(is.String),
		}),
		is.ObjectOf({
			type: is.LiteralOf(PluginLoadType.LOCAL),
		}),
	]),
]);

type UserDefinedPlugin = PredicateType<typeof isUserDefinedPlugin>;

type Plugin = {
	name: string;
	namespace: string;
	type: PluginLoadType;
	path: string;
	optDir: "opt" | "start";
	hooks: Function[];
};

const plugins: Record<string, Plugin> = {};
let packPath: string;
let denops: Denops;

function getName(plugin: Plugin): string {
	return path.join(plugin.namespace, plugin.optDir, plugin.name);
}

function parsePlugin(plugin: UserDefinedPlugin): Plugin {
	const pluginNameSplit = plugin.name.split("/");
	if (pluginNameSplit.length > 2) {
		throw new Error(`Invalid plugin name: ${plugin.name}`);
	} else {
		pluginNameSplit.unshift("unnamed");
	}
	return {
		name: pluginNameSplit[1],
		namespace: pluginNameSplit[0],
		optDir: plugin.opt ? "opt" : "start",
		hooks: plugin.hooks ?? [],
		type: plugin.type ?? PluginLoadType.GIT,
		path: plugin.path,
	};
}

async function pluginDirExists(plugin: Plugin): Promise<boolean> {
	const pluginDir = path.join(
		packPath,
		plugin.namespace,
		plugin.optDir,
		plugin.name,
	);

	return await fs.exists(pluginDir);
}

async function preparePluginBaseDir(plugin: Plugin): Promise<void> {
	const pluginBaseDir = path.join(packPath, plugin.namespace, plugin.optDir);
	await fs.ensureDir(pluginBaseDir);
}

async function installPlugin(plugin: Plugin): Promise<void> {
	if (await pluginDirExists(plugin)) return;
	await preparePluginBaseDir(plugin);

	const pluginInstallDir = path.join(
		packPath,
		plugin.namespace,
		plugin.optDir,
		plugin.name,
	);

	switch (plugin.type) {
		case "git": {
			const proc = await new Deno.Command("git", {
				args: ["clone", plugin.path, pluginInstallDir],
			}).output();
			if (!proc.success) {
				throw new Error(new TextDecoder().decode(proc.stderr).trim());
			}
			break;
		}
		case "local": {
			await Deno.symlink(plugin.path, pluginInstallDir);
			break;
		}
		default:
			throw new Error(`unknown plugin type: ${plugin.type}`);
	}

	return;
}

export const main: Entrypoint = (_denops) => {
	denops = _denops;
	denops.dispatcher = {
		async init() {
			const userDefinedPlugins: UserDefinedPlugin[] = await v.g.get(
				denops,
				"ppm_plugins",
			);
			assert(userDefinedPlugins, is.ArrayOf(isUserDefinedPlugin));

			packPath = path.join(
				(await o.packpath.get(denops)).split(",")[0],
				"pack",
			);

			for (const userDefinedPlugin of userDefinedPlugins) {
				const plugin = parsePlugin(userDefinedPlugin);

				plugins[getName(plugin)] = plugin;
			}

			const ensureVimDenops = await v.g.get(denops, "ppm_ensure_vim_denops");
			if (ensureVimDenops) {
				const denopsPlugin = parsePlugin({
					name: "vim-denops/denops.vim",
					path: "https://github.com/vim-denops/denops.vim",
				});
				plugins[getName(denopsPlugin)] = denopsPlugin;
			}

			const selfManage = await v.g.get(denops, "ppm_self_manage");
			if (selfManage) {
				const ppmPlugin = parsePlugin({
					name: "Pcrab/denops.vim",
					path: "https://github.com/Pcrab/ppm",
				});
				plugins[getName(ppmPlugin)] = ppmPlugin;
			}
		},
		async install() {
			const installPromises = Object.values(plugins).map(async (plugin) => {
				try {
					await installPlugin(plugin);
				} catch (e) {
					h.echoerr(denops, e);
				}
			});
			await Promise.all(installPromises);
		},

		async clean() {
			for await (const dirEntity of Deno.readDir(packPath)) {
				const namespace = dirEntity.name;

				const namespacePath = path.join(packPath, namespace);

				for await (const dirEntity of Deno.readDir(namespacePath)) {
					const optDir = dirEntity.name;

					const optPath = path.join(namespacePath, optDir);

					for await (const dirEntity of Deno.readDir(optPath)) {
						const name = dirEntity.name;

						const namePath = path.join(optPath, name);

						const pluginsSearchName = path.join(namespace, optDir, name);

						if (!plugins[pluginsSearchName]) {
							Deno.remove(namePath, {
								recursive: true,
							});
						}
					}
				}
			}
		},
	};
};
