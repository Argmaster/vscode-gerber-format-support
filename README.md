# Gerber X3/X2 Format Support

Gerber X3/X2 Format Support extension brings
[The Gerber Layer Format Specification](https://www.ucamco.com/files/downloads/file_en/456/gerber-layer-format-specification-revision-2023-03_en.pdf)
support to Visual Studio Code.

## Installation help

For full installation guide, please refer to
[this documentation](https://github.com/Argmaster/vscode-gerber-format-support/blob/main/INSTALLATION_GUIDE.md).

## Features

Opening new file with one of typical Gerber file extensions should allow
`Gerber X3/X2 Format Support` extension to automatically detect the language as
`Gerber`. If language is not detected automatically, You may click in bottom right
corner on `Plain Text` to change language to `Gerber`.

![select_language](https://github.com/Argmaster/vscode-gerber-format-support/assets/56170852/cb286a60-dad6-4bce-84cd-0c2e7ec2bd03)

![find_and_select_language](https://github.com/Argmaster/vscode-gerber-format-support/assets/56170852/e7edaa3c-91cf-46c6-8df7-03e5326e979b)

Afterwards all extension features should be available.

### 1. Syntax highlighting

![image](https://github.com/Argmaster/vscode-gerber-format-support/assets/56170852/6f815a6c-b54e-441d-9bdc-43ac9636cfeb)

### 2. Specification reference

Hovering over most common commands (currently only D01, D02, D03, G01, G02, G03, more in
the future) will show content of Gerber specification regarding hovered code.

![spec_reference](https://github.com/Argmaster/vscode-gerber-format-support/assets/56170852/62f07a80-3320-4f40-a375-db1487163aa2)

## Future plans

- [ ] full syntax highlighting support, including all Gerber X2 commands.
- [ ] deprecated syntax warnings
- [ ] interactive suggestions
- [ ] integration with [PyGerber](https://github.com/Argmaster/pygerber) for interactive
      visualization
- [ ] good practices linting
- [ ] pretty formatting
- [ ] minification
- [ ] ...?
