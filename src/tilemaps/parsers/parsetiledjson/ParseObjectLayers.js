var GetFastValue = require('../../../utils/object/GetFastValue');
var ParseObject = require('./ParseObject');
var ObjectLayer = require('../../mapdata/ObjectLayer');

var ParseObjectLayers = function (json)
{
    var objectLayers = [];

    for (var i = 0; i < json.layers.length; i++)
    {
        if (json.layers[i].type !== 'objectgroup')
        {
            continue;
        }

        var curo = json.layers[i];
        var offsetX = GetFastValue(curo, 'offsetx', 0);
        var offsetY = GetFastValue(curo, 'offsety', 0);
        var objects = [];

        for (var j = 0; j < curo.objects.length; j++)
        {
            var parsedObject = ParseObject(curo.objects[j], offsetX, offsetY);

            objects.push(parsedObject);
        }

        var objectLayer = new ObjectLayer(curo);
        objectLayer.objects = objects;

        objectLayers.push(objectLayer);
    }

    return objectLayers;
};

module.exports = ParseObjectLayers;
