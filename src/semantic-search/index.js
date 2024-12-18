import { find } from "./treeNode.js";

const sourceCode = `
const d=4;
function go() {
    const a = 5;
    const b = 6;
    console.log(a+b+d);
}
function test() {
    const c = 10;
    console.log(a+b);
}
`;

const pattern = `
function $FUNC() {
    /* ... */
    console.log($ABC);
    /* ... */
}
`;
const ans = await find(sourceCode, pattern);

console.log(ans);