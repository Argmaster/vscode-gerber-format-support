// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require("vscode");

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    /*
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "gerber-x3-x2-format-support" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with  registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('gerber-x3-x2-format-support.helloWorld', function () {
		// The code you place here will be executed every time your command is executed

		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from Gerber X3/X2 Format Support!');
	});
	context.subscriptions.push(disposable);
	*/
    function referenceSpecification(section) {
        return `<br/>
		See <a href="https://www.ucamco.com/files/downloads/file_en/456/gerber-layer-format-specification-revision-2023-03_en.pdf">The Gerber Layer Format Specification Revision 2023.03</a> section **${section}**`;
    }

    vscode.languages.registerHoverProvider("gerber", {
        provideHover(document, position, token) {
            let line_content_range = document.validateRange(
                new vscode.Range(
                    new vscode.Position(position.line, 0),
                    new vscode.Position(position.line + 1, 0)
                )
            );
            let line_content = document.getText(line_content_range);

            let extra = new vscode.MarkdownString(line_content);
            extra.supportHtml = true;
            extra.appendMarkdown(`\n`);

            if (line_content.indexOf("D01") != -1) {
                extra.appendMarkdown(`Operation with **D01** code is called a plot operation. It creates a straight-line segment or a
					circular segment by plotting from the current point to the operation coordinates. Outside a
					region statement the segment is then stroked with the current aperture to generate a draw
					or arc graphical object. In a region statement the segment is added to the contour being
					constructed. The current point is moved to operations coordinate before processing the
					next command.
					${referenceSpecification("4.8.1")}
				`);
            } else if (line_content.indexOf("D02") != -1) {
                extra.appendMarkdown(
                    `Operation with **D02** code is called move operation. It moves the current point to the
					operation coordinates. No graphical object is generated.
					${referenceSpecification("4.8.1")}
					`
                );
            } else if (line_content.indexOf("D03") != -1) {
                extra.appendMarkdown(
                    `Operation with **D03** code is called flash operation. It creates a flash object by replicating
					(flashing) the current aperture at the operation coordinates. When the aperture is flashed
					its origin is positioned at the coordinates of the operation. The origin of a standard aperture
					is its geometric center. The origin of a macro aperture is the origin used in the defining AM
					command. The current point is moved to operations coordinate before processing the next
					command.
					${referenceSpecification("4.8.1")}
					`
                );
            } else if (line_content.indexOf("G01") != -1) {
                extra.appendMarkdown(
                    `**G01** sets linear plot mode. In linear plot mode a D01 operation generates a linear segment, from
					the current point to the (X, Y) coordinates in the command. The current point is then set to the
					(X, Y) coordinates.</br>
					Outside a region statement the segment is stroked with the current aperture to create a draw
					graphical object. In a region statement the segment is added to the contour under construction.
					${referenceSpecification("4.7.2")}
					`
                );
            } else if (
                line_content.indexOf("G02") != -1 ||
                line_content.indexOf("G03") != -1
            ) {
                extra.appendMarkdown(
                    `**G02** sets clockwise circular plot mode, **G03** counterclockwise. In circular plot mode a D01
					operation generates an arc segment, from the current point to the (X, Y) coordinates in the
					command. The current point is then set to the (X, Y) coordinates.
					Outside a region statemen the segment is stroked with the current aperture to create an arc
					graphical object. In a region statement the segment is added to the contour under construction.
					For compatibility with older versions of the Gerber format, a G75* must be issued before the first
					D01 in circular mode.
					${referenceSpecification("4.7.2")}
					`
                );
            }
            return {
                contents: [extra],
            };
        },
    });
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
    activate,
    deactivate,
};
