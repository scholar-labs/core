import { find } from "./treeNode.js";

const sourceCode = `const d=3; function go() {console.log(a); const a = 5;}`;
const pattern = `function go() {$$$; const a=5;}`;
const ans = await find(sourceCode, pattern);

console.log(ans);