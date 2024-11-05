import prettier from 'prettier';
import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';

const parser = new Parser();
parser.setLanguage(JavaScript);

/** Special comment token used to represent wildcards in pattern matching */
const WILDCARD_COMMENT = '/* ... */';

/**
 * Finds all AST nodes in the source code that match a given pattern
 * @param {string} sourceCode - The source code to search through
 * @param {string} pattern - The pattern to match against
 * @returns {Promise<{nodes: Array<{node: Object, metavariables: Object}>}>} Matching nodes and their metavariables
 */
export async function find(sourceCode, pattern) {
    const formattedSourceCode = await format(sourceCode);
    const formattedPattern = await format(pattern);
   
    const sourceTree = parser.parse(formattedSourceCode);
    const allNodes = Array.from(traverseTree(sourceTree));
    const targetNode = parser.parse(formattedPattern).rootNode.firstChild;
   
    const matches = [];
   
    for(let sourceNode of allNodes) {
        const matchResult = equalsWithMetavars(sourceNode, targetNode);
        if(matchResult.matches) {
            matches.push({
                node: sourceNode,
                metavariables: matchResult.metavariables
            });
            sourceNode.metavariables = matchResult.metavariables;
        }
    }
   
    return { nodes: matches };
}

/**
 * Formats code using prettier with consistent settings
 * @param {string} code - The code to format
 * @returns {Promise<string>} Formatted code
 */
export function format(code) {
    return prettier.format(code, { semi: true, parser: 'babel' });
}

/**
 * Generator function that traverses the AST using a tree-sitter cursor
 * Uses iteration instead of recursion to prevent stack overflow
 * @param {Object} tree - The tree-sitter AST to traverse
 * @yields {Object} Each node in the tree
 */
function* traverseTree(tree) {
    const cursor = tree.walk();
   
    let reachedRoot = false;
    while (!reachedRoot) {
        let currentNode = cursor.currentNode;
        if (typeof currentNode === 'function') {
            currentNode = currentNode();
        }
        yield currentNode;
       
        if (cursor.gotoFirstChild()) continue;
        if (cursor.gotoNextSibling()) continue;
       
        let retracing = true;
        while (retracing) {
            if (!cursor.gotoParent()) {
                retracing = false;
                reachedRoot = true;
            }
           
            if (cursor.gotoNextSibling()) {
                retracing = false;
            }
        }
    }
}

/**
 * Checks if a node represents a wildcard pattern
 * @param {Object} node - The AST node to check
 * @returns {boolean} True if the node is a wildcard comment
 */
function isWildcard(node) {
    return node && 
           node.type === 'comment' && 
           node.text.trim() === '/* ... */';
}


/**
 * Gets the complete text content of a node and all its children
 * @param {Object} node - The AST node
 * @returns {string} The concatenated text of the node and its children
 */
function getNodeText(node) {
    if (!node) return '';
    
    if (node.childCount === 0) {
        return node.text;
    }
    
    let text = '';
    for (let i = 0; i < node.childCount; i++) {
        text += getNodeText(node.child(i));
    }
    return text;
}

/**
 * Checks if a node represents a metavariable (starts with $)
 * @param {Object} node - The AST node to check
 * @returns {boolean} True if the node is a metavariable
 */
function isMetavariable(node) {
    return node && node.type === 'identifier' && node.text.startsWith('$');
}

/**
 * Compares two AST nodes for equality, handling wildcards and metavariables
 * @param {Object} node1 - First AST node to compare
 * @param {Object} node2 - Second AST node to compare (pattern node)
 * @param {Object} [currentMetavars={}] - Current metavariable bindings
 * @returns {{matches: boolean, metavariables?: Object}} Match result and metavariable bindings
 */
function equalsWithMetavars(node1, node2, currentMetavars = {}) {
    if (!node1 || !node2) return { matches: false };
    
    // Handle wildcard matches
    if (isWildcard(node2)) {
        return {
            matches: true,
            metavariables: currentMetavars,
            consumedNodes: 0
        };
    }
    
    // Handle metavariable matches - now matches entire subtrees
    if (isMetavariable(node2)) {
        const metavarName = node2.text;
        const currentValue = currentMetavars[metavarName];
        const nodeText = getNodeText(node1);
        
        if (!currentValue) {
            // First occurrence of this metavariable
            return {
                matches: true,
                metavariables: { ...currentMetavars, [metavarName]: nodeText }
            };
        } else {
            // Subsequent occurrence - must match previous value
            return {
                matches: currentValue === nodeText,
                metavariables: currentMetavars
            };
        }
    }
    
    // Normal node matching
    if (node1.type !== node2.type) return { matches: false };
    
    // For leaf nodes
    if (node1.childCount === 0) {
        return {
            matches: node1.text === node2.text,
            metavariables: currentMetavars
        };
    }
    
    // For non-leaf nodes, handle wildcards and normal matches in children
    let currentMetavariables = { ...currentMetavars };
    let sourceIndex = 0;
    let patternIndex = 0;
    
    while (patternIndex < node2.childCount) {
        const patternChild = node2.child(patternIndex);
        
        if (isWildcard(patternChild)) {
            // Try to match the rest of the pattern after the wildcard
            const remainingPattern = node2.child(patternIndex + 1);
            if (!remainingPattern) {
                // Wildcard is the last element, consume all remaining source nodes
                return {
                    matches: true,
                    metavariables: currentMetavariables
                };
            }
            
            // Try matching with different numbers of nodes consumed by the wildcard
            while (sourceIndex < node1.childCount) {
                const nextSourceNode = node1.child(sourceIndex);
                const nextResult = equalsWithMetavars(
                    nextSourceNode,
                    remainingPattern,
                    currentMetavariables
                );
                
                if (nextResult.matches) {
                    return nextResult;
                }
                sourceIndex++;
            }
            return { matches: false };
            
        } else {
            if (sourceIndex >= node1.childCount) {
                return { matches: false };
            }
            
            const sourceChild = node1.child(sourceIndex);
            const childResult = equalsWithMetavars(
                sourceChild,
                patternChild,
                currentMetavariables
            );
            
            if (!childResult.matches) {
                return { matches: false };
            }
            
            currentMetavariables = childResult.metavariables;
            sourceIndex++;
            patternIndex++;
        }
    }
    
    // Make sure we've consumed all source nodes unless there was a trailing wildcard
    return {
        matches: sourceIndex === node1.childCount,
        metavariables: currentMetavariables
    };
}

/**
 * Checks if nodeA is contained within nodeB
 * @param {Object} nodeA - The potentially contained node
 * @param {Object} nodeB - The containing node
 * @returns {boolean} True if nodeA is inside nodeB
 */
export function inside(nodeA, nodeB) {
    return nodeA.startIndex >= nodeB.startIndex && nodeA.endIndex <= nodeB.endIndex;
}

/**
 * Checks if nodeA comes before nodeB in the source code
 * @param {Object} nodeA - First node
 * @param {Object} nodeB - Second node
 * @returns {boolean} True if nodeA precedes nodeB
 */
export function precedes(nodeA, nodeB) {
    return nodeA.endIndex <= nodeB.startIndex;
}

/**
 * Checks if nodeA comes after nodeB in the source code
 * @param {Object} nodeA - First node
 * @param {Object} nodeB - Second node
 * @returns {boolean} True if nodeA follows nodeB
 */
export function follows(nodeA, nodeB) {
    return nodeA.startIndex >= nodeB.endIndex;
}

/**
 * Checks if nodeB is a direct child of nodeA
 * @param {Object} nodeA - The potential parent node
 * @param {Object} nodeB - The potential child node
 * @returns {boolean} True if nodeB is a direct child of nodeA
 */
export function has(nodeA, nodeB) {
    for (let i = 0; i < nodeA.childCount; i++) {
        if (nodeA.child(i) === nodeB) {
            return true;
        }
    }
    return false;
}