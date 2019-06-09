import { isPrimitive, traverseValues, cleanUpMosaic, isBooleanAttribute, isKeyedArray, KeyedArray, getArrayDifferences, insertAfter } from "./util";
import Mosaic from "./index";
import { Template } from "./template";

type MemoryOptions = {
    type: string;
    steps: number[];
    attribute?: { name: string, value: any };
    event?: string;
}

/** A Memory is used to remember where in the DOM tree a change will occur.
* In other words, it keeps track of dynamic parts of a component. Later on,
* you can traverse the Memories contained in a Template to figure out what
* changed and what nodes need to be updated. */
export class Memory {
    type: string;
    steps: number[];
    attribute?: { name: string, value: any };
    event?: string;

    /** Defines a "Memory" object that is used to remember the location of
    * a DOM node that is or contains dynamic content.
    * @param {string} type The type of memory.
    * @param {Array} steps The steps taken to reach a node from its root.
    * @param {String} attribute For attribute types, the name and value
    * of the DOM attribute.
    * @param {String} event For event types, the name of the event handler. */
    constructor(options: MemoryOptions) {
        this.type = options.type;
        this.steps = options.steps;
        this.attribute = options.attribute;
        this.event = options.event;
    }

    /** Checks if the old value is different to the new value.
    * @param {Any} oldValue The old value.
    * @param {Any} newValue The new value.
    * @param {boolean} initiallyRendered Whether or not this is the first render. */
    changed(oldValue: any, newValue: any, initiallyRendered: boolean) {
        // console.log(oldValue, newValue);
        if(!oldValue || initiallyRendered === true) return true;

        // This basically checks the type that is being injected.
        if(isPrimitive(newValue)) {
            return oldValue !== newValue;
        }
        else if(typeof newValue === 'function') {
            return ('' + oldValue) === ('' + newValue);
        }
        else if(Array.isArray(newValue)) {
            return true; // for right now, always assume that arrays will be dirty.
        }
        else if(isKeyedArray(newValue)) {
            console.log('Old: ', ''+oldValue.keys);
            console.log('New: ', ''+newValue.keys);
            return true;
        }
        else if(typeof newValue === 'object') {
            // Check for when a Mosaic changes. Only consider it a change when:
            // - There is no new value
            // - The new value is either not an object or not a Mosaic
            // - The new value is a different Mosaic component type
            // - When the data changes between components
            if(oldValue instanceof Mosaic) {
                if(!newValue) {
                    cleanUpMosaic(oldValue as Mosaic);
                    return true;
                } else if(typeof newValue !== 'object' || !(newValue instanceof Mosaic)) {
                    cleanUpMosaic(oldValue as Mosaic);
                    return true;
                } else if(newValue.tid !== oldValue.tid) {
                    // Destroy the old component.
                    // Create the new component and its children.
                    cleanUpMosaic(oldValue as Mosaic);
                    traverseValues(newValue, (child: Mosaic) => {
                        if(child.portfolio) child.portfolio.addDependency(child);
                        if(oldValue.router) newValue.router = oldValue.router;
                        if(child.created) child.created();
                    });
                    return true;
                }

                // Here you know that they are the same Mosaic and it is not
                // changing, so just keep the same instance id.
                newValue.iid = oldValue.iid;
                
                // Last thing to check is if the injected data changed.
                let oldData = JSON.stringify((oldValue as Mosaic).injected);
                let newData = JSON.stringify((newValue as Mosaic).injected);
                if(oldData !== newData) {
                    cleanUpMosaic(oldValue as Mosaic);
                    return true;
                }
                return false;
            }
            // If the value to be injected is a template, just make a clone of
            // its element and place that in there.
            else if(newValue instanceof Template) {
                if(oldValue instanceof Template) return ''+oldValue.values !== ''+newValue.values;
                else return true;
            }
            else if(JSON.stringify(oldValue) !== JSON.stringify(newValue)) return true;
            else return false;
        }
        return false;
    }

    /** Does the work of actually committing necessary changes to the DOM.
    * @param {Mosaic} mosaic The Mosaic component for event binding.
    * @param {Any} oldValue The old value of this memory.
    * @param {Any} newValue The value to set on this Memory.
    * @param {Boolean} initial Whether or not this is the initial render. */
    commit(component: Mosaic|Element, oldValue: any, newValue: any, initial: boolean = true) {
        // Get the element and find the child node that is being referenced by this Memory.
        // Start from 2 because the first two indices are used for document-fragment and the node itself.
        let element = component instanceof Mosaic ? component.element as HTMLElement|ChildNode : component;
        let child = element;
        for(let i = 2; i < this.steps.length; i++) {
            let nextStep: number = this.steps[i];
            child = child.childNodes[nextStep];
        }

        // Check if it's a Mosaic, in which case use the same iid.
        if(oldValue instanceof Mosaic && newValue instanceof Mosaic) newValue.iid = oldValue.iid;

        // Send changes to the DOM.
        switch(this.type) {
            case "node": this.commitNode(component, child, oldValue, newValue, initial); break;
            case "attribute": this.commitAttribute(component, child, oldValue, newValue, initial); break;
            case "event": this.commitEvent(component, child, oldValue, newValue, initial); break;
            default: // console.log('Got here for some reason: '); break;
        }
    }

    /**
    * ------------- HELPERS -------------
    */

    /** Commits the changes for "node" types. */
    commitNode(component: Mosaic|Element, child: HTMLElement|ChildNode, oldValue: any, value: any, initial: boolean) {
        if(Array.isArray(value)) {
            this.commitArray(component, child, oldValue, value, initial);
        }
        else if(isKeyedArray(value)) {
            this.commitKeyedArray(component, child, oldValue, value, initial);
        }
        else if(value instanceof Mosaic) {
            // Set the parent/child properties of the Mosaics.
            if(component instanceof Mosaic) (value as any).parent = component;
            
            child.replaceWith((value as any).element);
            if(value.created) value.created();
        }
        else if(value instanceof Template) {
            let element = value.element.content.cloneNode(true).firstChild;
            value.repaint(element, [], value.values!!, true);
            child.replaceWith(element as ChildNode);
        }
        else {
            child.replaceWith(value);
        }
    }

    /** Commits the changes for "node" types where the value is an array. */
    commitArray(component: Mosaic|Element, child: Element|ChildNode, 
        oldValue: any[], value: any[], initial: boolean) {
        // Render the entire array. This works.
        const holder = document.createElement('span');
        for(let i = 0; i < value.length; i++) {
            const item = value[i];
            if(item instanceof Mosaic) {
                holder.appendChild(item.element);
                if(item.created) item.created();
            } else if(item instanceof Template) {
                let element: any = item.element.content.cloneNode(true).firstChild;
                item.repaint(element, [], item.values!!, true);
                holder.appendChild(element);
            }
        }
        child.replaceWith(holder);
    }

    /** Commits changes for a keyed array, doing efficient updating instead of a full rerender. */
    commitKeyedArray(component: Mosaic|Element, child: Element|ChildNode, 
        oldValue: KeyedArray, value: KeyedArray, initial: boolean) {
        // 1.) Deconstruct the keyed arrays.
        const oldItems = oldValue.items;
        const oldKeys = oldValue.keys;
        const oldMapped = oldValue.mapped;

        const newItems = value.items;
        const newKeys = value.keys;
        const newMapped = value.mapped;

        // 2.) If it is the initial render, then just place the entire array.
        // NOTE: This is a bad check since "initial" does not account for repainted
        // arrays; find a different way to check later on.
        if(initial === true) {
            let reference = child;
            const injectFunction = rep => {
                if(reference.nodeType === 8) {
                    reference.replaceWith(rep);
                    reference = rep;
                } else {
                    const n = insertAfter(rep, reference);
                    reference = n;
                }
            }

            // Add each element to the DOM and be sure to give it an ID.
            for(let i = 0; i < newMapped.length; i++) {
                const item = newMapped[i];
                const key = newKeys[i];

                if(item instanceof Mosaic) {
                    item.element.setAttribute('key', key);
                    injectFunction(item.element);
                    if(item.created) item.created();
                } else if(item instanceof Template) {
                    let element: any = item.element.content.cloneNode(true).firstChild;
                    element.setAttribute('key', key);
                    item.repaint(element, [], item.values!!, true);
                    injectFunction(item.element);
                }
            }
        }
        
        // 3.) If it is not the initial render, then you need to look for
        // deletions and additions. Once you have those, look for the items
        // with those keys and perform some action on them.
        else {
            // Find the differences between the two arrays by their keys.
            const differences = getArrayDifferences(oldKeys, newKeys);
            const { deletions, additions } = differences;
            
            // For each deletion, find the DOM node with that key and remove it.
            deletions.forEach(key => {
                const domNode = document.querySelector(`[key='${key}']`);
                if(domNode) domNode.remove();
            });

            // For each addition, look at the index that it was inserted at and
            // also look at the new mapped value associated with it. Then take
            // the new mapped item, give it the key, and insert it into the dom
            // at that index.
            additions.forEach(object => {
                const { key, index } = object;
                const newMappedItem = newMapped[index];
                newMappedItem.element.setAttribute('key', key);

                // Start from the "child" node, then go to its next sibling as
                // many times as it takes to get to the index.
                let siblings: ChildNode|null = child;
                for(let i = 0; i < index; i++) 
                    siblings = siblings === null ? null : siblings.nextSibling;
                
                // If the insert index is greater than the old array length,
                // append it. Otherwise replace it.
                if(index >= oldMapped.length) {
                    // append
                    if(siblings) insertAfter(newMappedItem.element, siblings.previousSibling);
                } else {
                    // replace
                    if(siblings) insertAfter(newMappedItem.element, siblings.previousSibling);
                }
                
                // Call the lifecycle function if it's a Mosaic.
                if(newMappedItem.created) newMappedItem.created();
            });
        }
    }

    /** Commits the changes for "attribute" types. */
    commitAttribute(component: Mosaic|Element, child: Element|ChildNode, oldValue: any, newValue: any, initial: boolean) {
        if(!this.attribute) return;

        let { name } = this.attribute;
        if(isBooleanAttribute(name)) {
            if(newValue === true) (child as Element).setAttribute(name, 'true');
            else (child as Element).removeAttribute(name);
        } else {
            (child as Element).setAttribute(name, newValue);
        }
    }

    /** Commits the changes for "event" types. Currently does not support
     * dynamically changing function attributes. */
    commitEvent(component: Mosaic|Element, child: Element|ChildNode, oldValue: any, value: any, initial: boolean) {
        let name: string = this.event || "";

        let eventHandlers = (child as any).eventHandlers || {};
        if(eventHandlers[name]) child.removeEventListener(name.substring(2), eventHandlers[name]);
        eventHandlers[name] = value.bind(component);

        (child as any).eventHandlers = eventHandlers;
        child.addEventListener(name.substring(2), (child as any).eventHandlers[name]);
        
        (child as Element).removeAttribute(name);
    }
}