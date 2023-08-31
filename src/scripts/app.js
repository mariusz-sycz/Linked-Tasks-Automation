define(["TFS/WorkItemTracking/Services", "TFS/WorkItemTracking/RestClient", "TFS/Work/RestClient", "q", "VSS/Controls", "VSS/Controls/StatusIndicator", "VSS/Controls/Dialogs"],
    function (_WorkItemServices, _WorkItemRestClient, workRestClient, Q, Controls, StatusIndicator, Dialogs) {

        var ctx = null;

        function AddTasks(workItemId){
            var witClient = _WorkItemRestClient.getClient();
            var workClient = workRestClient.getClient();

            var team = {
                projectId: ctx.project.id,
                teamId: ctx.team.id
            };

            var justCreatedTasks = [];

            workClient.getTeamSettings(team)
                .then(function (teamSettings) {
                    // Get the current values for a few of the common fields
                    witClient.getWorkItem(workItemId)
                        .then(function (value) {
                            var currentWorkItem = value.fields;

                            currentWorkItem['System.Id'] = workItemId;

                            var workItemType = currentWorkItem["System.WorkItemType"];
                            GetChildTypes(witClient, workItemType)
                                .then(function (childTypes) {
                                    if (childTypes == null)
                                        return;
                                    // get Templates
                                    getTemplates(childTypes)
                                        .then(function (response) {
                                            if (response.length == 0) {
                                                ShowDialog('No ' + childTypes + ' templates found. Please add ' + childTypes + ' templates for the project team.');
                                                return;
                                            }
                                            // Create children alphabetically.
                                            var templates = response.sort(SortTemplates);
                                            var chain = Q.when();
                                            templates.forEach(function (template) {
                                                chain = chain.then(createChildFromTemplate(witClient, workItemId, currentWorkItem, template, teamSettings, justCreatedTasks));
                                            });
                                            return chain;
                                        });
                                });
                        })
                })
        }

        function createChildFromTemplate(witClient, workItemId, currentWorkItem, template, teamSettings, justCreatedTasks) {
            return function () {
                return getTemplate(template.id).then(function (taskTemplate) {
                    // Create child
                    if (IsValidTemplateWIT(currentWorkItem, taskTemplate)) {
                        if (IsValidTemplateTitle(currentWorkItem, taskTemplate)) {
                            createWorkItem(workItemId, currentWorkItem, taskTemplate, teamSettings, justCreatedTasks)
                        }
                    }
                });
            };
        }

        function getRelatedWorkItems(witClient, workItemId, relationTypeToFilter, itemToLinkTo, relationTypeToLinkAs){
            console.log("Getting all '"+ relationTypeToFilter +"' related tasks for: " + workItemId);                                   
            let workItemExpand = 1; // 1- Relations     
            witClient.getWorkItem(workItemId, null, null, workItemExpand).then(function (result) {
                if(result != null && result.relations != null){
                    const relatedItems = result.relations.filter((el) => el.rel === relationTypeToFilter);
                    console.log("Found " + relatedItems.length + " off all " + result.relations.length + " relations:");
                    console.log(relatedItems);
                    console.log(result.relations);
                    relatedItems.forEach(function(item){
                        console.log('Linking to:' + item.url);   
                        if (itemToLinkTo.url !== item.url) {
                            linkImtes(witClient, itemToLinkTo.id, relationTypeToLinkAs, item.url)                                            
                        }
                    });
                }
            });
        }

        function createWorkItem(workItemId, currentWorkItem, taskTemplate, teamSettings, justCreatedTasks) {

            var witClient = _WorkItemRestClient.getClient();

            var newWorkItem = createWorkItemFromTemplate(currentWorkItem, taskTemplate, teamSettings);

            witClient.createWorkItem(newWorkItem, VSS.getWebContext().project.name, taskTemplate.workItemTypeName)
                .then(function (response) {
                    console.log('Request to create work item request:');
                    console.log(newWorkItem);
                    console.log('Respond with result:');
                    console.log(response);
                    justCreatedTasks.push(response); 

                    console.log('Proceed with created task: ' + response.id);
                    console.log('Linking to Parent:');
                    linkImtes(witClient, workItemId, "System.LinkTypes.Hierarchy-Forward", response.url)    
                    
                    var jsonFilters = extractJSON(taskTemplate.description)[0];
                    if (IsJsonString(JSON.stringify(jsonFilters))) {
                        if(jsonFilters.linkTo !== undefined && jsonFilters.linkTo.length > 0){
                            console.log('Task should be linked to:');
                            console.log(jsonFilters.linkTo);
                            jsonFilters.linkTo.forEach(function(linkTo){
                                console.log('Start linking for: '+ linkTo);
                                let linkToItem = linkTo.toUpperCase();
                                if(linkToItem == 'ToAllOtherChilds'.toUpperCase()){           
                                    console.log('Linking to ToAllOtherChilds');                                 
                                    getRelatedWorkItems(witClient,workItemId,'System.LinkTypes.Hierarchy-Forward', response, 'System.LinkTypes.Related');
                                } 
                                else if(linkToItem == 'ToAllJustCreatedTasks'.toUpperCase()){ 
                                    console.log('Linking to ToAllJustCreatedTasks:'); 
                                    console.log(justCreatedTasks); 
                                    justCreatedTasks.forEach(function (item) { 
                                        console.log('Linking to:' + item.url);    
                                        if (response.url !== item.url) {
                                            linkImtes(witClient, response.id, "System.LinkTypes.Related", item.url)                                            
                                        }
                                    });
                                }
                                else if(linkToItem == 'PreviouslyCreatedTask'.toUpperCase()){
                                    console.log('Linking to PreviouslyCreatedTask'); 
                                    if(justCreatedTasks.length > 1){
                                        var previouslyCreatedTask = justCreatedTasks[justCreatedTasks.length-2];
                                        console.log('Linking to:' + previouslyCreatedTask.url);
                                        linkImtes(witClient, response.id, "System.LinkTypes.Related", previouslyCreatedTask.url)    
                                    }
                                }
                                else if(linkToItem == 'PreviouslyJustCreatedTask'.toUpperCase()){
                                    console.log('Linking to PreviouslyJustCreatedTask'); 
                                    if(justCreatedTasks.length > 1){
                                        var previouslyCreatedTask = justCreatedTasks[justCreatedTasks.length-2];
                                        console.log('Linking to:' + previouslyCreatedTask.url);
                                        linkImtes(witClient, response.id, "System.LinkTypes.Related", previouslyCreatedTask.url)    
                                    }
                                }
                                else if(linkToItem == 'SecondPreviouslyJustCreatedTask'.toUpperCase()){
                                    console.log('Linking to SecondPreviouslyJustCreatedTask'); 
                                    if(justCreatedTasks.length > 2){
                                        var previouslyCreatedTask = justCreatedTasks[justCreatedTasks.length-3];
                                        console.log('Linking to:' + previouslyCreatedTask.url);
                                        linkImtes(witClient, response.id, "System.LinkTypes.Related", previouslyCreatedTask.url)    
                                    }
                                }
                                else if(linkToItem == 'FirstJustCreatedTask'.toUpperCase()){
                                    console.log('Linking to FirstJustCreatedTask'); 
                                    if(justCreatedTasks.length > 1){
                                        var previouslyCreatedTask = justCreatedTasks[0];
                                        console.log('Linking to:' + previouslyCreatedTask.url);
                                        linkImtes(witClient, response.id, "System.LinkTypes.Related", previouslyCreatedTask.url)    
                                    }
                                }
                                else if(linkToItem == 'SecondJustCreatedTask'.toUpperCase()){
                                    console.log('Linking to SecondJustCreatedTask'); 
                                    if(justCreatedTasks.length > 2){
                                        var previouslyCreatedTask = justCreatedTasks[1];
                                        console.log('Linking to:' + previouslyCreatedTask.url);
                                        linkImtes(witClient, response.id, "System.LinkTypes.Related", previouslyCreatedTask.url)    
                                    }
                                }                                    
                            });
                        }
                    } 
                }, function (error) {
                    console.log('Request to create work item request:');
                    console.log(newWorkItem);
                    console.log('Respond with ERROR result:');
                    console.log(error);
                    if(IsJsonString(error))
                    {
                        var errorObj = extractJSON(error);
                        console.log(errorObj);
                    }
                        ShowDialog(" Error createWorkItem: " + JSON.stringify(error));
                });
        }

        function linkImtes(witClient,newWorkItemId, relType, existedItemUrl){
            var document = [{
                op: "add",
                path: '/relations/-',
                value: {
                    rel: relType,
                    url: existedItemUrl,
                    attributes: {
                        isLocked: false,
                    }
                }
            }];
            console.log('Send doc:');
            witClient.updateWorkItem(document, newWorkItemId)
                .then(function (response) {
                    console.log('Request to update taskId:' + newWorkItemId + ' with document: ');
                    console.log(document);
                    console.log('Respond with result:');
                    console.log(response);
            }, function (error) {
                console.log('Request to update taskId:' + newWorkItemId + ' with document: ');
                console.log(document);
                console.log('Respond with ERROR result:');
                console.log(error);
                ShowDialog(" Error updateWorkItem: " + JSON.stringify(error));
            });
        }

        function createWorkItemFromTemplate(currentWorkItem, taskTemplate, teamSettings) {
            var workItem = [];

            for (var key in taskTemplate.fields) {
                if (IsPropertyValid(taskTemplate, key)) {
                    //if field value is empty copies value from parent
                    if (taskTemplate.fields[key] == '') {
                        if (currentWorkItem[key] != null) {
                            workItem.push({ "op": "add", "path": "/fields/" + key, "value": currentWorkItem[key] })
                        }
                    }
                    else {
                        var fieldValue = taskTemplate.fields[key];
                        //check for references to parent fields - {fieldName}
                        fieldValue = replaceReferenceToParentField(fieldValue, currentWorkItem);

                        workItem.push({ "op": "add", "path": "/fields/" + key, "value": fieldValue })
                    }
                }
            }

            // if template has no title field copies value from parent
            if (taskTemplate.fields['System.Title'] == null)
                workItem.push({ "op": "add", "path": "/fields/System.Title", "value": currentWorkItem['System.Title'] })

            // if template has no AreaPath field copies value from parent
            if (taskTemplate.fields['System.AreaPath'] == null)
                workItem.push({ "op": "add", "path": "/fields/System.AreaPath", "value": currentWorkItem['System.AreaPath'] })

            // if template has no IterationPath field copies value from parent
            // check if IterationPath field value is @currentiteration
            if (taskTemplate.fields['System.IterationPath'] == null)
                workItem.push({ "op": "add", "path": "/fields/System.IterationPath", "value": currentWorkItem['System.IterationPath'] })
            else if (taskTemplate.fields['System.IterationPath'].toLowerCase() == '@currentiteration')
                workItem.push({ "op": "add", "path": "/fields/System.IterationPath", "value": teamSettings.backlogIteration.name + teamSettings.defaultIteration.path })

            // check if AssignedTo field value is @me
            if (taskTemplate.fields['System.AssignedTo'] != null) {
                if (taskTemplate.fields['System.AssignedTo'].toLowerCase() == '@me') {
                    workItem.push({ "op": "add", "path": "/fields/System.AssignedTo", "value": ctx.user.uniqueName })
                }

                // if (taskTemplate.fields['System.AssignedTo'].toLowerCase() == '') {
                //     if (WIT['System.AssignedTo'] != null) {
                //         workItem.push({ "op": "add", "path": "/fields/System.AssignedTo", "value": currentWorkItem['System.AssignedTo'] })
                //     }
                // }
            }

            return workItem;
        }

        function IsValidTemplateWIT(currentWorkItem, taskTemplate) {

            WriteTrace("template: '" + taskTemplate.name + "'");
            
            // If not empty, does the description have the old square bracket approach or new JSON?
            var jsonFilters = extractJSON(taskTemplate.description)[0];
            if (IsJsonString(JSON.stringify(jsonFilters))) {
                // example JSON:
                //
                //   {
                //      "applywhen": [
                //        {
                //          "System.State": "Approved",
                //          "System.Tags" : ["Blah", "ClickMe"],
                //          "System.WorkItemType": "Product Backlog Item"
                //        },
                //        {
                //          "System.State": "Approved",
                //          "System.Tags" : ["Blah", "ClickMe"],
                //          "System.WorkItemType": "Product Backlog Item"
                //        }
                //         ]
                //    }

                WriteTrace("filter: '" + JSON.stringify(jsonFilters) + "'");

                var rules = jsonFilters.applywhen;
                if (!Array.isArray(rules))
                    rules = new Array(rules);

                var matchRule = rules.some(filters => {

                    var matchFilter = Object.keys(filters).every(function (prop) {

                        var matchfield = matchField(prop, currentWorkItem, filters);
                        WriteTrace(" - filter['" + prop + "'] : '" + filters[prop] + "' - wit['" + prop + "'] : '" + currentWorkItem[prop] + "' equal ? " + matchfield);
                        return matchfield
                    });

                    return matchFilter;
                });

                return matchRule;


            } else {
                var filters = taskTemplate.description.match(/[^[\]]+(?=])/g);

                if (filters) {
                    var isValid = false;
                    for (var i = 0; i < filters.length; i++) {
                        var found = filters[i].split(',').find(function (f) { return f.trim().toLowerCase() == currentWorkItem["System.WorkItemType"].toLowerCase() });
                        if (found) {
                            isValid = true;
                            break;
                        }
                    }
                    return isValid;
                } else {
                    return false; //Change to false to do not create templates without filter in description
                }
            }
        }

        function matchField(fieldName, currentWorkItem, filterObject) {
            try {
                if (currentWorkItem[fieldName] == null)
                    return false;

                if (typeof (filterObject[fieldName]) === "undefined")
                    return false;

                // convert it to array for easy compare
                var filterValue = filterObject[fieldName];
                if (!Array.isArray(filterValue))
                    filterValue = new Array(String(filterValue));

                var currentWorkItemValue = currentWorkItem[fieldName];
                if (fieldName == "System.Tags") {
                    currentWorkItemValue = currentWorkItem[fieldName].split("; ");
                }
                else {
                    if (!Array.isArray(currentWorkItemValue))
                        currentWorkItemValue = new Array(String(currentWorkItemValue));
                }


                var match = filterValue.some(i => {
                    return currentWorkItemValue.findIndex(c => i.toLowerCase() === c.toLowerCase()) >= 0;
                })

                return match;
            }
            catch (e) {
                WriteError('matchField ' + e);
                return false;
            }

        }

        function IsValidTemplateTitle(currentWorkItem, taskTemplate) {
            var jsonFilters = extractJSON(taskTemplate.description)[0];
            var isJSON = IsJsonString(JSON.stringify(jsonFilters));
            if (isJSON) {
                return true;
            }
            var filters = taskTemplate.description.match(/[^{\}]+(?=})/g);
            var curTitle = currentWorkItem["System.Title"].match(/[^{\}]+(?=})/g);
            if (filters) {
                var isValid = false;
                if (curTitle) {
                    for (var i = 0; i < filters.length; i++) {
                        if (curTitle.indexOf(filters[i]) > -1) {
                            isValid = true;
                            break;
                        }
                    }

                }
                return isValid;
            } else {
                return true;
            }

        }
        
        function extractJSON(str) {
            var firstOpen, firstClose, candidate;
            firstOpen = str.indexOf('{', firstOpen + 1);

            if (firstOpen != -1) {
                do {
                    firstClose = str.lastIndexOf('}');

                    if (firstClose <= firstOpen) {
                        return null;
                    }
                    do {
                        candidate = str.substring(firstOpen, firstClose + 1);

                        try {
                            var res = JSON.parse(candidate);

                            return [res, firstOpen, firstClose + 1];
                        }
                        catch (e) {
                            WriteError('extractJSON ...failed ' + e);
                        }
                        firstClose = str.substr(0, firstClose).lastIndexOf('}');
                    } while (firstClose > firstOpen);
                    firstOpen = str.indexOf('{', firstOpen + 1);
                } while (firstOpen != -1);
            } else { return ''; }
        }

        function IsJsonString(str) {
            try {
                JSON.parse(str);
            } catch (e) {
                return false;
            }
            return true;
        }

        function IsPropertyValid(taskTemplate, key) {
            if (taskTemplate.fields.hasOwnProperty(key) == false) {
                return false;
            }
            if (key.indexOf('System.Tags') >= 0) { //not supporting tags for now
                return false;
            }
            if (taskTemplate.fields[key].toLowerCase() == '@me') { //current identity is handled later
                return false;
            }
            if (taskTemplate.fields[key].toLowerCase() == '@currentiteration') { //current iteration is handled later
                return false;
            }

            return true;
        }

        function replaceReferenceToParentField(fieldValue, currentWorkItem) {
            var filters = fieldValue.match(/[^{\}]+(?=})/g);
            if (filters) {
                for (var i = 0; i < filters.length; i++) {
                    var parentField = filters[i];
                    var parentValue = currentWorkItem[parentField];

                    fieldValue = fieldValue.replace('{' + parentField + '}', parentValue)
                }
            }
            return fieldValue;
        }

        function findWorkTypeCategory(categories, workItemType) {
            for (category of categories) {
                var found = category.workItemTypes.find(function (w) { return w.name == workItemType; });
                if (found != null) {
                    return category;
                }
            }
        }

        function getTemplate(id) {
            var witClient = _WorkItemRestClient.getClient();
            return witClient.getTemplate(ctx.project.id, ctx.team.id, id);
        }
        

        function SortTemplates(a, b) {
            var nameA = a.name.toLowerCase(), nameB = b.name.toLowerCase();
            if (nameA < nameB) //sort string ascending
                return -1;
            if (nameA > nameB)
                return 1;
            return 0; //default return value (no sorting)
        }

        function getTemplates(workItemTypes) {

            var requests = []
            var witClient = _WorkItemRestClient.getClient();

            workItemTypes.forEach(function (workItemType) {

                var request = witClient.getTemplates(ctx.project.id, ctx.team.id, workItemType);
                requests.push(request);
            }, this);

            return Q.all(requests)
                .then(function (templateTypes) {

                    var templates = [];
                    templateTypes.forEach(function (templateType) {
                        if (templateType.length > 0) {

                            templateType.forEach(function (element) {
                                templates.push(element)
                            }, this);
                        }
                    }, this);
                    return templates;
                });
        }
        

        function GetChildTypes(witClient, workItemType) {

            return witClient.getWorkItemTypeCategories(VSS.getWebContext().project.name)
                .then(function (response) {
                    var categories = response;
                    var category = findWorkTypeCategory(categories, workItemType);

                    if (category != null) {
                        var requests = [];
                        var workClient = workRestClient.getClient();

                        var team = {
                            projectId: ctx.project.id,
                            teamId: ctx.team.id
                        };

                        bugsBehavior = workClient.getTeamSettings(team).bugsBehavior; //Off, AsTasks, AsRequirements

                        if (category.referenceName === 'Microsoft.EpicCategory') {
                            return witClient.getWorkItemTypeCategory(VSS.getWebContext().project.name, 'Microsoft.FeatureCategory')
                                .then(function (response) {
                                    var category = response;

                                    return category.workItemTypes.map(function (item) { return item.name; });
                                });
                        } else if (category.referenceName === 'Microsoft.FeatureCategory') {
                            requests.push(witClient.getWorkItemTypeCategory(VSS.getWebContext().project.name, 'Microsoft.RequirementCategory'));
                            if (bugsBehavior === 'AsRequirements') {
                                requests.push(witClient.getWorkItemTypeCategory(VSS.getWebContext().project.name, 'Microsoft.BugCategory'));
                            }
                        } else if (category.referenceName === 'Microsoft.RequirementCategory') {
                            requests.push(witClient.getWorkItemTypeCategory(VSS.getWebContext().project.name, 'Microsoft.TaskCategory'));
                            requests.push(witClient.getWorkItemTypeCategory(VSS.getWebContext().project.name, 'Microsoft.TestCaseCategory'));
                            if (bugsBehavior === 'AsTasks') {
                                requests.push(witClient.getWorkItemTypeCategory(VSS.getWebContext().project.name, 'Microsoft.BugCategory'));
                            }
                        } else if (category.referenceName === 'Microsoft.BugCategory' && bugsBehavior === 'AsRequirements') {
                            requests.push(witClient.getWorkItemTypeCategory(VSS.getWebContext().project.name, 'Microsoft.TaskCategory'));
                        } else if (category.referenceName === 'Microsoft.TaskCategory') {
                            requests.push(witClient.getWorkItemTypeCategory(VSS.getWebContext().project.name, 'Microsoft.TaskCategory'));
                        } else if (category.referenceName == 'Microsoft.BugCategory') {
                            requests.push(witClient.getWorkItemTypeCategory(VSS.getWebContext().project.name, 'Microsoft.TaskCategory'));
                        }

                        return Q.all(requests)
                            .then(function (response) {
                                var categories = response;

                                var result = [];
                                categories.forEach(function (category) {
                                    category.workItemTypes.forEach(function (workItemType) {
                                        result.push(workItemType.name);
                                    });
                                });
                                return result;
                            });


                    }
                });
        }
        
        function getWorkItemFormService() {
            let service = 
            _WorkItemServices.WorkItemFormService.getService().then(function (response) { service = response});
            return service;
        }
        
        function Log(msg) {
            console.log('linked-tasks-automation: ' + msg);
        }

        function WriteTrace(msg) {
            console.log('1-Click Child-Links: ' + msg);
        }

        function WriteLog(msg) {
            console.log('1-Click Child-Links: ' + msg);
        }

        function WriteError(msg) {
            console.error('1-Click Child-Links: ' + msg);
        }
        

        return {

            create: function (context) {
                Log('init v0.0.1');
                console.log(context);

                ctx = VSS.getWebContext();
                if (context.workItemIds && context.workItemIds.length > 0) {
                    context.workItemIds.forEach(function (workItemId) {
                        AddTasks(workItemId);
                    });
                }
                else if (context.id) {
                    AddTasks(context.id);
                }
                else if (context.workItemId) {
                    AddTasks(context.workItemId);
                }   
            },
        }

    });
