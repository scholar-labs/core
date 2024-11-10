import { scan, loadRules } from "./src/rule-analysis/ruleAnalyzer.js";

const sourceCode = `const a=5;
console.log(a)
const b=6
const a=5;
console.log(a)
const b=6
`;

const yamlRules = `
- id: "some-rule"
  message: "found!"
  rule:
    pattern: "const $X=5"
    precedes:
      pattern: "console.log($X)"
`;

const rules = loadRules(yamlRules);
const results = await scan(sourceCode, rules);

console.log(results);