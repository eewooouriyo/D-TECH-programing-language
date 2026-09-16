import socket
import threading
import tkinter as tk
from tkinter import ttk, messagebox
import json
import os
import uuid
import getpass
import sys
import time

SIGNATURE = "DTECH_SUPPORTED"
PROTOCOL_VERSION = 1
DHT_PORT = 45454
CONNECT_TIMEOUT = 5
SEARCH_TIME = 8

# Initial nodes for DTH.
# For local tests use:
# 127.0.0.1:45454
#
# For real internet you need to put here varius nodes
# Public D-TECH.
BOOTSTRAP_NODES = []

CURRENT_USER = getpass.getuser()
NODE_ID = uuid.uuid4().hex

servers = {}
servers_lock = threading.Lock()

stop_search = threading.Event()
network_socket = None
current_connection = None
current_server = None


def send_json(sock, data):
    raw = (json.dumps(data, separators=(",", ":")) + "\n").encode("utf-8")
    sock.sendall(raw)


def recv_json(sock):
    buffer = b""

    while True:
        data = sock.recv(4096)

        if not data:
            return None

        buffer += data

        if b"\n" in buffer:
            line, _, _ = buffer.partition(b"\n")

            try:
                return json.loads(line.decode("utf-8"))
            except Exception:
                return None


def add_server(server):
    if not isinstance(server, dict):
        return

    if server.get("signature") != SIGNATURE:
        return

    host = server.get("host")
    port = server.get("port")

    if not host or not port:
        return

    key = f"{host}:{port}"

    with servers_lock:
        servers[key] = {
            "id": server.get("id", key),
            "name": server.get("name", "D-TECH Server"),
            "host": host,
            "port": int(port),
            "signature": SIGNATURE,
            "version": server.get("version", PROTOCOL_VERSION)
        }


def query_bootstrap(host, port):
    sock = None

    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(2)

        packet = {
            "type": "find_servers",
            "signature": SIGNATURE,
            "node_id": NODE_ID,
            "version": PROTOCOL_VERSION
        }

        sock.sendto(
            json.dumps(packet).encode("utf-8"),
            (host, int(port))
        )

        start = time.time()

        while time.time() - start < 2:
            try:
                data, _ = sock.recvfrom(65535)
            except socket.timeout:
                break

            try:
                response = json.loads(data.decode("utf-8"))
            except Exception:
                continue

            if response.get("type") == "servers":
                for server in response.get("servers", []):
                    add_server(server)

            elif response.get("type") == "server":
                add_server(response.get("server"))

    except Exception:
        pass

    finally:
        if sock:
            sock.close()


def search_network():
    stop_search.clear()

    threads = []

    for host, port in BOOTSTRAP_NODES:
        if stop_search.is_set():
            break

        thread = threading.Thread(
            target=query_bootstrap,
            args=(host, port),
            daemon=True
        )

        thread.start()
        threads.append(thread)

    start = time.time()

    while time.time() - start < SEARCH_TIME:
        if stop_search.is_set():
            break

        time.sleep(0.1)


def connect_to_server(server):
    global current_connection
    global current_server

    host = server["host"]
    port = int(server["port"])

    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(CONNECT_TIMEOUT)
        sock.connect((host, port))
        sock.settimeout(None)

        send_json(
            sock,
            {
                "type": "join_request",
                "signature": SIGNATURE,
                "version": PROTOCOL_VERSION,
                "node_id": NODE_ID,
                "user": CURRENT_USER
            }
        )

        response = recv_json(sock)

        if not response:
            sock.close()
            return False, "The server closed the server."

        if response.get("type") == "rejected":
            reason = response.get(
                "reason",
                "The server rejected your request."
            )

            sock.close()
            return False, reason

        if response.get("type") != "accepted":
            sock.close()
            return False, "Unknown response by server."

        current_connection = sock
        current_server = server

        return True, None

    except Exception as e:
        return False, str(e)


def receive_messages(sock, print_lock):
    while True:
        try:
            message = recv_json(sock)

            if not message:
                print("\n[NETWORK] The server closed the connection.")
                break

            if message.get("type") == "message":
                user = message.get("user", "SERVER")
                text = message.get("text", "")

                with print_lock:
                    print(f"\n@{user}:=> {text}")
                    print(
                        f"USER@{CURRENT_USER}=:> ",
                        end="",
                        flush=True
                    )

            elif message.get("type") == "server_message":
                text = message.get("text", "")

                with print_lock:
                    print(f"\n@SERVER:=> {text}")
                    print(
                        f"USER@{CURRENT_USER}=:> ",
                        end="",
                        flush=True
                    )

            elif message.get("type") == "disconnect":
                with print_lock:
                    print("\n[SERVER] Disconneted by server.")

                break

        except Exception as e:
            with print_lock:
                print(f"\n[NETWORK] Error: {e}")

            break


def terminal_session(sock):
    print()
    print("========================================")
    print("        D-TECH NETWORK CONNECTED")
    print("========================================")
    print()
    print(f"Server: {current_server.get('name', 'D-TECH Server')}")
    print()
    print(f"USER@{CURRENT_USER}=:> ", end="", flush=True)

    print_lock = threading.Lock()

    receiver = threading.Thread(
        target=receive_messages,
        args=(sock, print_lock),
        daemon=True
    )

    receiver.start()

    while receiver.is_alive():
        try:
            text = input()

        except (EOFError, KeyboardInterrupt):
            break

        if not text:
            print(
                f"USER@{CURRENT_USER}=:> ",
                end="",
                flush=True
            )
            continue

        try:
            send_json(
                sock,
                {
                    "type": "message",
                    "user": CURRENT_USER,
                    "text": text
                }
            )

        except Exception:
            break

        print(
            f"USER@{CURRENT_USER}=:> ",
            end="",
            flush=True
        )

    try:
        send_json(
            sock,
            {
                "type": "disconnect",
                "user": CURRENT_USER
            }
        )
    except Exception:
        pass

    try:
        sock.close()
    except Exception:
        pass


class NetworkGUI:

    def __init__(self):
        self.root = tk.Tk()

        self.root.title(
            "D-TECH Network"
        )

        self.root.geometry(
            "650x400"
        )

        self.root.resizable(
            False,
            False
        )

        self.searching = False

        self.build_search_screen()

    def clear(self):
        for widget in self.root.winfo_children():
            widget.destroy()

    def build_search_screen(self):
        self.clear()

        frame = tk.Frame(
            self.root
        )

        frame.pack(
            fill="both",
            expand=True,
            padx=30,
            pady=30
        )

        title = tk.Label(
            frame,
            text="SEARCHING SERVERS",
            font=("Segoe UI", 18, "bold")
        )

        title.pack(
            pady=(20, 30)
        )

        self.status = tk.Label(
            frame,
            text="Searching D-TECH servers..."
        )

        self.status.pack(
            pady=10
        )

        self.progress = ttk.Progressbar(
            frame,
            mode="indeterminate",
            length=400
        )

        self.progress.pack(
            pady=20
        )

        self.cancel_button = tk.Button(
            frame,
            text="CANCEL",
            width=18,
            command=self.cancel_search
        )

        self.cancel_button.pack(
            pady=20
        )

        self.searching = True

        self.progress.start(
            10
        )

        threading.Thread(
            target=self.search_thread,
            daemon=True
        ).start()

    def search_thread(self):
        search_network()

        if self.searching:
            self.root.after(
                0,
                self.show_servers
            )

    def cancel_search(self):
        self.searching = False
        stop_search.set()

        self.progress.stop()

        self.root.destroy()

    def show_servers(self):
        self.searching = False

        self.clear()

        frame = tk.Frame(
            self.root
        )

        frame.pack(
            fill="both",
            expand=True,
            padx=20,
            pady=20
        )

        title = tk.Label(
            frame,
            text="ONLINE SERVERS",
            font=("Segoe UI", 18, "bold")
        )

        title.pack(
            pady=(5, 15)
        )

        container = tk.Frame(
            frame
        )

        container.pack(
            fill="both",
            expand=True
        )

        with servers_lock:
            found = list(
                servers.values()
            )

        if not found:
            label = tk.Label(
                container,
                text="No servers found."
            )

            label.pack(
                pady=30
            )

        else:
            for server in found:
                row = tk.Frame(
                    container
                )

                row.pack(
                    fill="x",
                    pady=5
                )

                name = tk.Label(
                    row,
                    text=server["name"],
                    anchor="w",
                    width=35
                )

                name.pack(
                    side="left"
                )

                connect = tk.Button(
                    row,
                    text="CONECT",
                    width=12,
                    command=lambda s=server:
                        self.connect(s)
                )

                connect.pack(
                    side="right"
                )

        cancel = tk.Button(
            frame,
            text="CANCEL",
            width=18,
            command=self.cancel_search
        )

        cancel.pack(
            pady=10
        )

    def connect(self, server):
        result = connect_to_server(
            server
        )

        success, error = result

        if not success:
            messagebox.showerror(
                "D-TECH Network",
                f"Cannot connect:\n\n{error}"
            )

            return

        self.root.destroy()

        terminal_session(
            current_connection
        )

    def run(self):
        self.root.mainloop()


def main():
    print(
        "[D-TECH NETWORK] Initializing..."
    )

    print(
        f"[D-TECH NETWORK] User: {CURRENT_USER}"
    )

    print(
        f"[D-TECH NETWORK] Node ID: {NODE_ID}"
    )

    gui = NetworkGUI()

    gui.run()


if __name__ == "__main__":
    main()
