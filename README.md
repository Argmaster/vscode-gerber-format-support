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

![image](https://github.com/Argmaster/vscode-gerber-format-support/assets/56170852/b8406013-901b-4d47-9b9d-1871e40d11c5)

### 2. Language Server using PyGerber

This extension utilizes PyGerber 2.1.0 builtin Gerber language server. To use this
feature you will need to install Python 3.8+ on your device and Visual Studio Python
Extension from Microsoft.

After starting this extension for the first time you will be presented with popup in
bottom right corner asking if you want to install PyGerber automatically. Currently it
is recommended to use this option, as alternatives are not well polished.

![image](https://github.com/Argmaster/vscode-gerber-format-support/assets/56170852/56f40939-de68-4dda-9b9a-281727b52720)

#### 1. Gerber X3 Rev. 2023.03 reference

![hover_hint_d01](https://github.com/Argmaster/vscode-gerber-format-support/assets/56170852/54b4cf45-45ac-4295-8f44-e034b9ae6d9e)

#### 2. Live suggestions (limited functionality)

![image](https://github.com/Argmaster/vscode-gerber-format-support/assets/56170852/f239d97f-aa63-4297-83a9-f3fab467b517)

#### 3. Quick rendering (limited customization)

![image](https://github.com/Argmaster/vscode-gerber-format-support/assets/56170852/64725da7-1e6e-4281-87a8-e4105d6b89f9)

![image](https://github.com/Argmaster/vscode-gerber-format-support/assets/56170852/ffd7e7a7-2d95-41ec-bfc5-b60e68219f98)

Click on the image, hold Ctrl and use mouse wheel to zoom in and out.

## Issues and bugs

Please report all issues and encountered bugs to
[Issue section on Github](https://github.com/Argmaster/vscode-gerber-format-support/issues).

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
