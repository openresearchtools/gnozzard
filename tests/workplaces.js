// SPDX-License-Identifier: GPL-3.0-or-later
import GLib from 'gi://GLib';

const [, bytes] = GLib.file_get_contents('extension/gnozzard@openresearchtools/workplaces.js');
const source = new TextDecoder().decode(bytes).replace(/^import .+;\n/gm, '').replace(/^export /gm, '');
let count = 0;
function assert(value, message) { count++; if (!value) throw new Error(message); }
let workspaces, active, saved, calls;
const manager = {
    get_n_workspaces: () => workspaces.length,
    get_workspace_by_index: index => workspaces[index],
    reorder_workspace(workspace, target) {
        calls++;
        workspaces.splice(workspaces.indexOf(workspace), 1);
        workspaces.splice(target, 0, workspace);
    },
};
const settings = {
    get_value: () => new GLib.Variant('ai', saved),
    set_value: (_key, value) => { saved = value.deepUnpack(); },
};
const {reorderWorkplace} = new Function('GLib', 'global', source + '\nreturn {reorderWorkplace};')(
    GLib, {workspace_manager: manager});

for (const size of [1, 2, 3, 8]) {
    for (let index = 0; index < size; index++) {
        for (const offset of [-2, -1, 0, 1, 2]) {
            workspaces = Array.from({length: size}, (_, id) => ({id,
                index() { return workspaces.indexOf(this); }, windows: [{id}]}));
            const original = [...workspaces];
            const moved = workspaces[index];
            active = moved;
            const disabled = original.filter(w => w.id % 2 === 1);
            saved = disabled.map(w => w.index());
            calls = 0;
            const target = index + offset;
            const valid = [-1, 1].includes(offset) && index > 0 && target > 0 && target < size;
            assert(reorderWorkplace(moved, offset, settings) === valid, 'Reject invalid moves');
            assert(calls === Number(valid), 'Use exactly one native reorder, or none');
            assert(workspaces.length === size, 'Never create or remove workplaces');
            assert(workspaces[0] === original[0], 'Desktop stays first');
            assert(active === moved && moved.windows[0].id === moved.id, 'Keep workspace and window identity');
            assert(workspaces.every(w => original.includes(w)), 'No replacement workplace objects');
            assert(moved.index() === (valid ? target : index), 'Correct destination index');
            assert(JSON.stringify(saved) === JSON.stringify(disabled.map(w => w.index()).sort((a, b) => a - b)),
                'Per-workplace tiling preference follows the workplace, including restart persistence');
        }
    }
}
assert(!reorderWorkplace({index: () => -1}, 1, settings), 'An already removed workplace cannot move');
print(`Workplace reordering: ${count} assertions passed`);
