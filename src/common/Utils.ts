import ApexDoc from '../engine/ApexDoc';
import GeneratorUtils from '../engine/generators/GeneratorUtils';
import { ApexModel } from './models/ApexModel';
import { ClassModel } from './models/ClassModel';
import { resolve } from 'path';
import { window, workspace, WorkspaceFolder } from 'vscode';

export type Option<T, V = undefined> = T | V;

export const last = <T>(arr: T[]): T => arr.length > 1 ? arr[arr.length - 1] : arr[0];

class Utils {
    private static readonly PRIVATE: string = 'private';
    private static readonly TEST_METHOD: string = 'testmethod';
    private static COLLECTIONS: string[] = ['list', 'set', 'map'];
    private static KEYWORDS: string[] = [
        'abstract',
        'final',
        'virtual',
        'override',
        'void',
        'blob',
        'boolean',
        'date',
        'datetime',
        'decimal',
        'double',
        'id',
        'integer',
        'long',
        'object',
        'string',
        'time'
    ];

    public static isClassOrInterface(line: string): boolean {
        // Account for inner classes or @isTest classes without an access modifier; implicitly private
        if (/.*\bclass\b.*/.test(line.toLowerCase()) || /\s?\binterface\s/i.test(line.toLowerCase())) {
            return true;
        }

        return false;
    }

    public static isEnum(line: string): boolean {
        line = this.stripAnnotations(line);
        if (/^(global\s+|public\s+|private\s+)?enum\b.*/.test(line)) {
            return true;
        }

        return false;
    }

    public static stripAnnotations(line: string): string {
        let i = 0;
        while (line && line.trim().startsWith('@')) {
            line = line.trim().replace(/@\w+\s*(\([\w=.*''/\s]+\))?/, '');
            if (i >= 100) {
                break; // infinite loop protect, just in case
            }
            i++;
        }

        return line;
    }

    /**
     * Helper method to determine if a line being parsed should be skipped.
     * Ignore lines not dealing with scope unless they start with the certain keywords:
     * We do not want to skip @isTest classes, inner classes, inner interfaces, or inner
     * enums defined without without explicit access modifiers. These are assumed to be
     * private. Also, interface methods don't have scope, so don't skip those lines either.
     */
    public static shouldSkipLine(line: string, cModel?: ClassModel): boolean {
        let classNameParts = cModel && cModel.name.split('.') || [''];
        let className = last(classNameParts);

        if (!this.getScope(line) &&
            !line.toLowerCase().startsWith(ApexDoc.ENUM + " ") &&
            !line.toLowerCase().startsWith(ApexDoc.CLASS + " ") &&
            !line.toLowerCase().startsWith(ApexDoc.INTERFACE + " ") &&
            // don't skip default constructors without access modifiers
            !(cModel && new RegExp('\\b' + className + '\\s*\\(').test(line)) &&
            // don't skip interface methods - they don't have access modifiers
            !(cModel && cModel.isInterface && line.includes('('))) {
                return true;
        }

        return false;
    }

    /** Can match some implicitly private methods, but not all! */
    public static getScope(line: string): Option<string, void> {
        for (let scope of ApexDoc.config.scope) {
            // if line starts with annotations, replace them, so
            // we can accurately use startsWith to match scope.
            line = this.stripAnnotations(line).toLowerCase().trim();
            scope = scope.toLowerCase();

            // line starts with registered scope
            if (line.startsWith(scope + ' ')) {
                return scope;
            }

            // current scope is testmethod and our line is a test method
            if (scope === this.TEST_METHOD && line.startsWith(`static ${this.TEST_METHOD} `)) {
                return scope;
            }
        }

        // try to reasonably match implicitly private lines if
        // 'private' included in user's documentable scopes list
        if (ApexDoc.config.scope.includes(this.PRIVATE)) {
            // match static props or methods
            if (line.startsWith('static ') && !line.includes(` ${this.TEST_METHOD} `)) {
                return this.PRIVATE;
            }

            // match methods that start with
            // keywords or return primitive types
            for (let keyword of this.KEYWORDS) {
                if (line.startsWith(keyword + ' ') && line.includes('(')) {
                    return this.PRIVATE;
                }
            }

            // match methods that return collections
            for (let collection of this.COLLECTIONS) {
                if (new RegExp('^' + collection + '<.+>\\s.*').test(line) && line.includes('(')) {
                    return this.PRIVATE;
                }
            }
        }
    }

    public static previousWord(str: string, searchIdx: number): string {
        if (!str) {
            return '';
        }

        if (searchIdx >= str.length) {
            return '';
        }

        let idxStart: number, idxEnd: number;
        for (idxStart = searchIdx - 1, idxEnd = 0; idxStart > 0; idxStart--) {
            if (idxEnd === 0) {
                if (str.charAt(idxStart) === ' ') {
                    continue;
                }
                idxEnd = idxStart + 1;
            } else if (str.charAt(idxStart) === ' ') {
                idxStart++;
                break;
            }
        }

        return str.substring(idxStart, idxEnd);
    }

    public static countChars(str: string, char: string): number {
        let count = 0;
        for (let i = 0; i < str.length; ++i) {
            if (str.charAt(i) === char) {
                ++count;
            }
        }
        return count;
    }

    public static isURL(str: string): boolean {
        if (!str) {
            return false;
        }

        // TODO: consider all cases. Should we just use Validator?
        // Definitely if there are other validation cases which call for another method from it.
        return /^(https?):\/\/[-a-zA-Z0-9+&@#/%?=~_|!:,.;]*[-a-zA-Z0-9+&@#/%=~_|]/.test(str.trim());
    }

    public static resolveWorkspaceFolder(path: string): string {
        // should be safe to cast this as not-undefined
        // If running this tool, workspace folders should always exist.
        const folders = <WorkspaceFolder[]>(workspace.workspaceFolders);

        const rootFolderRe = /\$\{workspaceFolder\}(.*)?/;
        const multiFolderRe = /\$\{workspaceFolder:(.*)\}(.*)/;

        if (rootFolderRe.test(path)) {
            const results = <RegExpExecArray>rootFolderRe.exec(path);
            return resolve(folders[0].uri.fsPath, ...results[1].split(/\\|\//));
        } else if (multiFolderRe.test(path)) {
            const results = <RegExpExecArray>multiFolderRe.exec(path);
            for (let folder of folders) {
                if (folder.name === results[1]) {
                    return resolve(folder.uri.fsPath, ...results[2].split(/\\|\//));
                }
            }

            window.showWarningMessage(`Workspace variable in path '${path}' could not be resolved.`);
        }

        return path;
    }
}

export default Utils;