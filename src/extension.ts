// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import WebSocket = require('ws');
import { RemoteFile, setupServer } from './LightRemoteServer';

let server: WebSocket.Server | undefined = undefined;
let fileSystemProviderDisp: vscode.Disposable;

const remoteFiles: RemoteFile[] = [];

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log("version:", process.env);

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('lightremote.setupServer', onSetupServer);
	context.subscriptions.push(disposable);

	fileSystemProviderDisp = vscode.workspace.registerFileSystemProvider("lightremote-file", new LightRemoteFileSystemProvider(), { isCaseSensitive: true });
	vscode.window.tabGroups.onDidChangeTabs((e) => {
		console.log("onDidChangeTabs:", e);
		e.closed.forEach((tab) => {
			console.log("Tab Close:", tab);
			console.log("tab.input:", tab.input);

			if (!(tab.input instanceof vscode.TabInputText) || tab.input.uri.scheme !== "lightremote-file") { return; }
			let uri = (tab.input as vscode.TabInputText).uri;
			let idx = remoteFiles.findIndex((val) => val.address === uri.authority && val.path === uri.path);
			console.log("uri:", uri);
			console.log("idx:", idx);
			if (idx === -1) { return; }
			remoteFiles[idx].close();
			remoteFiles[idx] = remoteFiles[remoteFiles.length - 1];
			remoteFiles.pop();
		});
	});
	// vscode.workspace.onDidCloseTextDocument((doc) => {
	// 	if (doc.uri.scheme === "lightremote-file") {
	// 		let idx = remoteFiles.findIndex((val) => val.address === doc.uri.authority && val.path === doc.uri.path);
	// 		console.log("CloseTextDoc:", idx);
	// 		if (idx === -1) { return; }
	// 		remoteFiles[idx].close();
	// 		remoteFiles[idx] = remoteFiles[remoteFiles.length - 1];
	// 		remoteFiles.pop();
	// 	}
	// });

}

// This method is called when your extension is deactivated
export function deactivate() {
	fileSystemProviderDisp.dispose();
}

// async function test() {
// 	let res = await vscode.window.showQuickPick(["123","abc"],{title:"aaaaa"});
// 	console.log(res);
// 	// vscode.workspace.registerFileSystemProvider("lightremote-file",);
// 	// let doc = await vscode.workspace.openTextDocument(vscode.Uri.file("D:\\test52.txt"));
// 	// vscode.window.showTextDocument(doc);
// }





class LightRemoteFileSystemProvider implements vscode.FileSystemProvider {
	private emitter: vscode.EventEmitter<vscode.FileChangeEvent[]>;
	readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]>;
	constructor() {
		this.emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
		this.onDidChangeFile = this.emitter.event;
	}
	watch(uri: vscode.Uri, options: { readonly recursive: boolean; readonly excludes: readonly string[]; }): vscode.Disposable {
		console.log("WatchFile:", uri);
		return vscode.Disposable.from();
	}
	async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
		console.log("stat", uri);
		let file = remoteFiles.find((val) => val.address === uri.authority && val.path === uri.path);
		console.log("find", file);
		if (file === undefined) { throw new Error("can not find file: " + uri.toString()); }
		let stat = await file.fileStat();
		return {
			type: vscode.FileType.File,
			ctime: 0,
			mtime: 0,
			size: stat.size,
		};
	}
	readDirectory(uri: vscode.Uri): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]> {
		throw new Error('Method not implemented.');
	}
	createDirectory(uri: vscode.Uri): void | Thenable<void> {
		throw new Error('Method not implemented.');
	}
	readFile(uri: vscode.Uri): Promise<Uint8Array> {
		console.log("readFile", uri);
		console.log("remoteFiles", remoteFiles);
		let file = remoteFiles.find((val) => val.address === uri.authority && val.path === uri.path);
		console.log("find", file);
		if (file === undefined) { throw new Error("can not find file: " + uri.toString()); }
		return file.readFile();
	}
	writeFile(uri: vscode.Uri, content: Uint8Array, options: { readonly create: boolean; readonly overwrite: boolean; }): Promise<void> {
		console.log("writeFile", uri);
		let file = remoteFiles.find((val) => val.address === uri.authority && val.path === uri.path);
		if (file === undefined) { throw new Error("can not find file: " + uri.toString()); }
		return file.writeFile(Buffer.from(content));
	}
	delete(uri: vscode.Uri, options: { readonly recursive: boolean; }): void | Thenable<void> {
		throw new Error('Method not implemented.');
	}
	rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { readonly overwrite: boolean; }): void | Thenable<void> {
		throw new Error('Method not implemented.');
	}
	copy?(source: vscode.Uri, destination: vscode.Uri, options: { readonly overwrite: boolean; }): void | Thenable<void> {
		throw new Error('Method not implemented.');
	}
}

function onSetupServer() {
	if (server !== undefined) {
		vscode.window.showErrorMessage("Server has been setup.");
		return;
	}
	server = setupServer(vscode.workspace.getConfiguration('LightRemote').get<number>("serverPort")!, (file) => {
		console.log("new connection:", file);
		file.onClose = (code, reason) => {
			vscode.window.showInformationMessage("connection closed. code:" + code + "reason:" + reason);
		};
		file.onError = (err) => {
			console.log("connection error: ", err);
			vscode.window.showErrorMessage("connection error: " + err.message);
		};
		let existingFileIdx = remoteFiles.findIndex((val) => val.address === file.address && val.path === file.path);
		if (existingFileIdx !== -1) {
			vscode.window.showWarningMessage<string>("New connection for " + file.address + "//" + file.path + "do you want to switch to it?", "yes", "no").then((val) => {
				if (val === "yes") { remoteFiles[existingFileIdx] = file; }
				else { file.close(); }
			});
			return;
		}
		remoteFiles.push(file);
		try {
			let uri = vscode.Uri.parse("lightremote-file://" + file.address + "/" + encodeURIComponent(file.path));
			console.log("uri:", uri.toString());
			console.log("uri.path:", uri.path);
			vscode.workspace.openTextDocument(uri).then((val) => {
				console.log("open:", val);
				vscode.window.showTextDocument(val);
			}, (err) => {
				console.log("open failed:", err);
			});
		} catch (e) {
			console.log("Error:", e);
		}
		vscode.window.showInformationMessage("File Opened: " + file.address + "/" + file.path, { modal: true });
	}, (err) => {
		vscode.window.showErrorMessage("Error: " + err.message);
	});
	vscode.window.setStatusBarMessage("Setup Server...",2000);
}