# OpenJudge VSCode Extension

A modern, feature-complete VSCode extension for the OpenJudge online judge system. Write, submit, and track your solutions directly from Visual Studio Code!

## Features

- **Authentication**: Secure login to OpenJudge with session management
- **Problem Explorer**: Browse groups, practices, and problems in a tree view
- **Problem Viewer**: Beautiful webview display of problem details with syntax highlighting
- **Code Submission**: Submit solutions directly from VSCode
- **Real-time Status**: Monitor submission status with automatic polling
- **Multi-language Support**: Python, C++, C, and Java
- **Smart Features**:
  - Copy sample input/output with one click
  - Automatic language detection
  - Submission history tracking
  - Syntax highlighting in problem descriptions

## Installation

### From Source (Development)

1. Clone this repository
2. Install [Bun](https://bun.sh) if you haven't already
3. Run `bun install` to install dependencies
4. Run `bun run compile` to build the extension
5. Press F5 in VSCode to launch the extension in development mode

### From Marketplace (Coming Soon)

Search for "OpenJudge" in the VSCode Extensions marketplace and click Install.

## Usage

### 1. Login

- Click the OpenJudge icon in the activity bar
- Click "Login to OpenJudge" or use Command Palette (`Ctrl+Shift+P`) and search for "OpenJudge: Login"
- Enter your email and password

### 2. Browse Problems

- Expand groups in the Problem Explorer
- Expand practices/contests to see problems
- Click on a problem to view details

### 3. Submit Solutions

- Open a code file with your solution
- Click the submit button in the problem webview, or
- Use the submit icon in the tree view, or
- Right-click in the editor and select "Submit Solution"

### 4. View Status

- After submission, a new panel will open showing the status
- The status updates automatically every 2 seconds
- Final results show time, memory, and any error messages

## Configuration

Access settings via `File > Preferences > Settings` and search for "OpenJudge":

- `openjudge.defaultGroup`: Default group subdomain (default: "python")
- `openjudge.autoRefresh`: Auto-refresh problem list on activation (default: true)
- `openjudge.submissionPollingInterval`: Status polling interval in ms (default: 2000)

## Requirements

- Visual Studio Code 1.80.0 or higher
- [Bun](https://bun.sh) (for development)
- Active internet connection
- OpenJudge account

## Extension Architecture

The extension follows modern VSCode extension best practices:

- **TypeScript**: Fully typed codebase
- **Modular Design**: Separate services for API, parsing, UI
- **Cookie Management**: Persistent session handling
- **Webview API**: Modern, secure problem display
- **Tree View API**: Efficient problem browsing

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## Support

For issues and feature requests, please visit the [GitHub repository](https://github.com/yourusername/openjudge-vscode).

## Credits

Developed with reference to LeetCode VSCode extension and OpenJudge API documentation.
