import * as vscode from 'vscode';
import { Socket } from "dgram";
import * as net from "net";
import { Stream } from "stream";
import * as WebSocket from "ws";

const selfVersion = "0.1.0";
const MSG_FILE = 1;
const MSG_SOURCE_CHANGED = 2;
const MSG_WRITE_FILE = 3;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class RemoteFile {
    readonly address: string;
    readonly path: string;
    wsocket: WebSocket;
    onChanged?: (file: RemoteFile) => void;
    onClose?: (code: number, reason: Buffer) => void;
    onError?: (error: Error) => void;
    private fileBuffer?: Buffer;

    constructor(address: string, path: string, wsocket: WebSocket) {
        this.address = address;
        this.path = path;
        this.wsocket = wsocket;
        wsocket.binaryType = "nodebuffer";
        wsocket.on("message", (rawData, isBinary) => {
            if (!isBinary) { return; }
            let buffer = rawData as Buffer;
            let msg = buffer.readInt8();
            switch (msg) {
                case MSG_FILE:
                    this.fileBuffer = buffer.slice(1);
                    break;
                case MSG_SOURCE_CHANGED:
                    //TODO: on file changed
                    break;
            }

        });
        wsocket.on("close", (code, reason) => {
            if (this.onClose === undefined || this.onClose === null) { return; }
            this.onClose(code, reason);
        });
        wsocket.on("error", (err) => {
            if (this.onError === undefined || this.onError === null) { return; }
            this.onError(err);
        });

    }
    async readFile(): Promise<Buffer> {
        while (this.fileBuffer === undefined) {
            await delay(100);
        }
        return this.fileBuffer;
    }
    async fileStat(): Promise<{ size: number }> {
        while (this.fileBuffer === undefined) {
            await delay(100);
        }
        return { size: this.fileBuffer.length };
    }
    writeFile(buffer: Buffer): Promise<void> {
        var sendBuff = Buffer.alloc(1 + buffer.length);
        sendBuff.writeInt8(MSG_WRITE_FILE);
        buffer.copy(sendBuff, 1);
        return new Promise<void>((resolve, reject) => {
            this.wsocket.send(sendBuff, (err) => {
                if (err === undefined) { resolve(); }
                reject(err);
            });
        });
    }
    close() {
        this.wsocket.close();
    }
}

// const remoteFiles: RemoteFile[] = [];

export function setupServer(port: number, onConnect: (file: RemoteFile) => void, onError: (err: Error) => void) {
    console.log("setupServer:", port);
    const wss = new WebSocket.Server({
        port: port
    });

    //如果有WebSocket请求接入，wss对象可以响应connection事件来处理这个WebSocket：
    wss.on('connection', (ws, req) => {  //在connection事件中，回调函数会传入一个WebSocket的实例，表示这个WebSocket连接。
        let address = (req.socket.address() as net.AddressInfo).address;
        let path = req.headers["lightremote-path"]?.toString()!;
        let version = req.headers["lightremote-version"]?.toString()!;


        if (version !== selfVersion) {
            onError(new Error("Error: Version not match:\nserver(local): " + selfVersion + "\nclient(remote): " + version));
            return;
        }
        // let uri = "lightremote-file://" + address + "/" + path;

        // let existingFile = remoteFiles.find((val) => val.uri === uri);
        // if (existingFile) {
        //     vscode.window.showWarningMessage<string>("New connection for " + uri + "do you want to switch to it?", "yes", "no").then((val) => {
        //         if (val === "yes") { existingFile!.wsocket = ws; }
        //     });
        //     return;
        // }
        let file = new RemoteFile(address, path, ws);
        // remoteFiles.push(file);
        onConnect(file);
    });
    return wss;
}


