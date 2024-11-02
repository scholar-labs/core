import prettier from 'prettier';
import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';

// initialize tree-sitter parser
const parser = new Parser();
parser.setLanguage(JavaScript);

// returns array of matching nodes
export async function find(sourceCode, pattern) {
  
    // object to store final result
    let result = {};

    // object to store metavariables and their values
    let metavariables = {};
   
    // array to store matched nodes
    let matchingNodes = [];
   
    // format using prettier
    const formattedSourceCode = await format(sourceCode);
    const formattedPattern = await format(pattern);

    // generate syntax tree and create an array of nodes
    const sourceTree = parser.parse(formattedSourceCode);
    const allNodes = Array.from(traverseTree(sourceTree));

    // generate syntax tree for pattern
    const targetNode = parser.parse(formattedPattern).rootNode.firstChild;

    for(let sourceNode of allNodes) {
        if(equalsWithWildcard(sourceNode, targetNode)) {
            matchingNodes.push(sourceNode);
        }
    }
    
    result.nodes = matchingNodes;
    return result;
}

// formats code using prettier
export function format(code) {
    return prettier.format(code, { semi: true, parser: 'babel' });
}

// Check if nodeA is inside nodeB (Check if nodeA has nodeB as a descendant)
export function inside(nodeA, nodeB) {
    return nodeA.startIndex >= nodeB.startIndex && nodeA.endIndex <= nodeB.endIndex;
}

// Check if nodeA precedes nodeB
export function precedes(nodeA, nodeB) {
    return nodeA.endIndex <= nodeB.startIndex;
}

// Check if nodeA follows nodeB
export function follows(nodeA, nodeB) {
    return nodeA.startIndex >= nodeB.endIndex;
}

// Check if nodeA has nodeB as a child
export function has(nodeA, nodeB) {
    for (let i = 0; i < nodeA.childCount; i++) {
        if (nodeA.child(i) === nodeB) {
            return true;
        }
    }
    return false;
}

function* traverseTree(tree) {
    const cursor = tree.walk();
 
    let reachedRoot = false;
    while (!reachedRoot) {
        let currentNode = cursor.currentNode;
        // Compatibility adjustment for Node vs Browser
        if (typeof currentNode === 'function') {
            currentNode = currentNode();
        }
        yield currentNode;
 
        if (cursor.gotoFirstChild()) {
            continue;
        }
 
        if (cursor.gotoNextSibling()) {
            continue;
        }
 
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

function equalsWithWildcard(node1, node2) {
    // Check if the pattern contains our wildcard symbol
    if (node2.text.includes('$$$')) {
        // For a wildcard pattern, we only need to match the surrounding structure
        // Split the pattern text by the wildcard
        const parts = node2.text.split('$$$');
        const start = parts[0];
        const end = parts[1];
        
        // Check if the source node's text starts and ends with the pattern parts
        return node1.text.startsWith(start) && node1.text.endsWith(end);
    }
    
    // If no wildcard, perform exact matching
    return node1.text === node2.text && 
           node1.type === node2.type && 
           node1.childCount === node2.childCount;
}

// Helper function to extract the content matched by wildcards
export function getWildcardContent(node, pattern) {
    if (!pattern.includes('$$$')) {
        return null;
    }
    
    const parts = pattern.split('$$$');
    const start = parts[0];
    const end = parts[1];
    
    // Extract the content between the start and end patterns
    const content = node.text.slice(
        start.length,
        node.text.length - end.length
    );
    
    return content;
}