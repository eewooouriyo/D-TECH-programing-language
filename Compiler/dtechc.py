import sys
import os

HELP = """
D-TECH Compiler

Sintax:
    dtechc (POSIBLE ARGUMENTS) file.dtech

Arguments:
    -onefile       Generates a EXE of one file
    -no-console    Generate the EXE without console
    --help         Show this help
"""

def main():
    args = sys.argv[1:]

    if not args or "--help" in args:
        print(HELP)
        return

    source = None
    onefile = False
    dteche = False
    no_console = False

    for arg in args:
        if arg == "-onefile":
            onefile = True
        elif arg == "--dteche":
            dteche = True
        elif arg == "-no-console":
            no_console = True
        elif arg.startswith("-"):
            print(f"Unkown argument: {arg}")
            return
        else:
            source = arg

    if source is None:
        print("Error: .dtech file missing")
        return

    if not os.path.isfile(source):
        print(f"Error: dont exist '{source}'")
        return

    if not source.endswith(".dtech"):
        print("Error: the file must be .dtech extention")
        return

    print(f"Compiling: {source}")

    if dteche:
        print(f"you already have dteche what more do you want?")
        
    else:
        output = os.path.splitext(source)[0] + ".exe"
        print(f"Output EXE: {output}")
        # Here will be the EXE creation

if __name__ == "__main__":
    main()