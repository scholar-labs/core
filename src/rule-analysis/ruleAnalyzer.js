import yaml from "js-yaml";
import { find, inside, has, follows, precedes } from "../semantic-search/treeNode.js";

/**
 * Represents a code scanning result
 * @typedef {Object} ScanResult
 * @property {string} ruleId - The ID of the matched rule
 * @property {string} message - The message associated with the rule
 * @property {number} startLine - Starting line of the match
 * @property {number} endLine - Ending line of the match
 * @property {string} matchedText - The text that matched the pattern
 * @property {Object} metavariables - Any metavariables captured in the match
 */

/**
 * Represents a pattern with potential context
 * @typedef {Object} Pattern
 * @property {string} pattern - The pattern to match
 * @property {Object} [inside] - Inside context constraint
 * @property {Object} [has] - Has context constraint
 * @property {Object} [follows] - Follows context constraint
 * @property {Object} [precedes] - Precedes context constraint
 */

/**
 * Loads and parses rules from a YAML file
 * @param {string} yamlContent - The YAML file content
 * @returns {Array<Object>} Parsed rules
 */
export function loadRules(yamlContent) {
  try {
    const rules = yaml.load(yamlContent);
    if (!Array.isArray(rules)) {
      return [rules];
    }
    return rules;
  } catch (error) {
    throw new Error(`Failed to parse rules: ${error.message}`);
  }
}

/**
 * Recursively validates a pattern and its context patterns
 * @param {Pattern} patternObj - The pattern object to validate
 * @param {string} path - Current validation path for error messages
 * @throws {Error} If the pattern configuration is invalid
 */
function validatePattern(patternObj, path = "rule") {
  if (!patternObj.pattern) {
    throw new Error(`Pattern must be defined at ${path}`);
  }

  const contextTypes = ["inside", "has", "follows", "precedes"];
  
  // Check each context type for nested patterns
  for (const contextType of contextTypes) {
    if (patternObj[contextType]) {
      // Recursively validate nested pattern
      validatePattern(patternObj[contextType], `${path}.${contextType}`);
    }
  }
}

/**
 * Validates a complete rule configuration
 * @param {Object} rule - The rule to validate
 * @throws {Error} If the rule is invalid
 */
function validateRule(rule) {
  if (!rule.id) {
    throw new Error("Rule must have an id");
  }
  if (!rule.message) {
    throw new Error("Rule must have a message");
  }
  if (!rule.rule) {
    throw new Error("Rule must have a rule object");
  }

  validatePattern(rule.rule);
}

/**
 * Gets line numbers for a node from its start and end byte indices
 * @param {string} sourceCode - The complete source code
 * @param {number} startIndex - Start byte index
 * @param {number} endIndex - End byte index
 * @returns {{startLine: number, endLine: number}} Line numbers
 */
function getLineNumbers(sourceCode, startIndex, endIndex) {
  const upToStart = sourceCode.slice(0, startIndex);
  const upToEnd = sourceCode.slice(0, endIndex);

  const startLine = (upToStart.match(/\n/g) || []).length + 1;
  const endLine = (upToEnd.match(/\n/g) || []).length + 1;

  return { startLine, endLine };
}

/**
 * Gets the accurate text content of a node
 * @param {Object} node - The AST node
 * @returns {string} The actual text content
 */
function getAccurateMatchText(node) {
  if (!node || !node.text) return "";
  return node.text;
}

/**
 * Checks if metavariables are consistent between matches
 * @param {Object} existingMetavars - Current set of metavariables
 * @param {Object} newMetavars - New metavariables to check
 * @returns {boolean} True if all shared metavariables have matching values
 */
function checkMetavariableConsistency(existingMetavars, newMetavars) {
  for (const [key, value] of Object.entries(newMetavars)) {
    if (existingMetavars[key] !== undefined && existingMetavars[key] !== value) {
      return false;
    }
  }
  return true;
}

/**
 * Recursively finds matches for a pattern and verifies all its context constraints
 * @param {string} sourceCode - The source code to scan
 * @param {Pattern} patternObj - The pattern object
 * @param {Object} node - The current node to check contexts against (if any)
 * @param {Object} metavars - Current metavariables to maintain consistency
 * @returns {Promise<Array<Object>>} Array of valid matches
 */
async function findValidMatches(sourceCode, patternObj, node = null, metavars = {}) {
  // Find matches for the current pattern
  const currentMatches = await find(sourceCode, patternObj.pattern);
  
  // If this is a context pattern (node is provided), filter matches that satisfy position and metavars
  if (node) {
    currentMatches.nodes = currentMatches.nodes.filter(match => {
      // Check metavariable consistency
      for (const [key, value] of Object.entries(match.metavariables)) {
        if (metavars[key] !== undefined && metavars[key] !== value) {
          return false;
        }
      }
      return true;
    });
  }

  const validMatches = [];

  // For each match at this level, verify all its context constraints
  for (const match of currentMatches.nodes) {
    let isValidMatch = true;
    const combinedMetavars = { ...metavars, ...match.metavariables };

    // Check each context type
    const contextTypes = {
      inside,
      has,
      follows,
      precedes
    };

    for (const [contextType, contextPattern] of Object.entries(patternObj)) {
      if (contextType === "pattern") continue;

      // Find valid matches for this context that satisfy both position and nested contexts
      const contextMatches = await findValidMatches(
        sourceCode,
        contextPattern,
        match.node,
        combinedMetavars
      );

      // For this context type, at least one context match must satisfy the position constraint
      const hasValidContextMatch = contextMatches.some(contextMatch => 
        contextTypes[contextType](match.node, contextMatch.node)
      );

      if (!hasValidContextMatch) {
        isValidMatch = false;
        break;  // No need to check other contexts if one fails
      }
    }

    if (isValidMatch) {
      validMatches.push(match);
    }
  }

  return validMatches;
}

/**
 * Scans source code using provided rules
 * @param {string} sourceCode - The source code to scan
 * @param {Array<Object>} rules - The rules to apply
 * @returns {Promise<Array<ScanResult>>} Scan results
 */
export async function scan(sourceCode, rules) {
  const results = [];

  for (const rule of rules) {
    validateRule(rule);

    // Find all valid matches that satisfy the complete context chain
    const validMatches = await findValidMatches(sourceCode, rule.rule);

    // Convert matches to results
    for (const match of validMatches) {
      const { startLine, endLine } = getLineNumbers(
        sourceCode,
        match.node.startIndex,
        match.node.endIndex
      );

      results.push({
        ruleId: rule.id,
        message: rule.message,
        startLine,
        endLine,
        matchedText: getAccurateMatchText(match.node),
        metavariables: match.metavariables
      });
    }
  }

  return results;
}